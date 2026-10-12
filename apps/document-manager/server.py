#!/usr/bin/env python3
"""Local-only UI/API forwarding uploads into the existing Hindsight file pipeline."""
import hashlib, hmac, json, mimetypes, os, secrets, sqlite3, threading, time, uuid
from email.parser import BytesParser
from email.policy import default
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(os.environ.get("DOCUMENT_MANAGER_CONFIG", ROOT / "document-manager/config.json"))
if not CONFIG_PATH.exists():
    CONFIG_PATH = ROOT / "document-manager/config.example.json"
CONFIG = json.loads(CONFIG_PATH.read_text())
DB_PATH = Path(os.environ.get("DOCUMENT_MANAGER_DB", ROOT / "data/document-manager/jobs.sqlite3"))
HOST = os.environ.get("DOCUMENT_MANAGER_HOST", CONFIG.get("host", "127.0.0.1"))
PORT = int(os.environ.get("DOCUMENT_MANAGER_PORT", CONFIG.get("port", 8765)))
API = os.environ.get("HINDSIGHT_URL", CONFIG["hindsight_url"]).rstrip("/")
BANK = os.environ.get("HINDSIGHT_BANK_ID", CONFIG["bank_id"])
MAX_BYTES = int(os.environ.get("DOCUMENT_MANAGER_MAX_BYTES", CONFIG.get("upload_max_bytes", 20 * 1024 * 1024)))
MAX_FILES = 32
ALLOWED = set(CONFIG.get("allowed_extensions", [".pdf", ".docx", ".txt", ".md", ".markdown"]))
SESSION_TOKEN = secrets.token_urlsafe(32)
LOCK = threading.RLock()
DOC_CACHE = {"at": 0.0, "items": []}
DOC_CACHE_LOCK = threading.Lock()


def ui_status(value):
    return {"pending": "queued", "queued": "queued", "processing": "processing", "completed": "completed", "failed": "failed"}.get(value, "failed" if value == "cancelled" else value)


def is_loopback_host(host):
    return isinstance(host, str) and host.casefold() in {"localhost", "127.0.0.1", "::1"}


def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, filename TEXT NOT NULL, size INTEGER NOT NULL,
          sha256 TEXT NOT NULL UNIQUE, document_id TEXT NOT NULL, status TEXT NOT NULL,
          operation_id TEXT, progress INTEGER NOT NULL DEFAULT 0, chunks INTEGER NOT NULL DEFAULT 0,
          error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")


def rowdict(row):
    d = dict(row)
    d["progress"] = int(d["progress"])
    return d


def create_job(filename, size, digest):
    docid = "sbdoc_" + digest
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with LOCK, db() as c:
        row = c.execute("SELECT * FROM jobs WHERE sha256=?", (digest,)).fetchone()
        if row:
            existing = rowdict(row)
            existing["_created"] = False
            return existing
        jid = str(uuid.uuid4())
        c.execute("INSERT INTO jobs(id,filename,size,sha256,document_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)", (jid, filename, size, digest, docid, now, now))
        created = rowdict(c.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone())
        created["_created"] = True
        return created


def get_job(jid):
    with db() as c:
        row = c.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone()
        return rowdict(row) if row else None


def update_job(jid, **fields):
    fields["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cols = ",".join(f"{k}=?" for k in fields)
    with LOCK, db() as c:
        c.execute(f"UPDATE jobs SET {cols} WHERE id=?", (*fields.values(), jid))


def api(path, data=None, method=None, headers=None, timeout=30):
    raw = None if data is None else json.dumps(data).encode()
    h = {"Accept": "application/json"}
    if raw is not None: h["Content-Type"] = "application/json"
    h.update(headers or {})
    req = Request(API + path, data=raw, headers=h, method=method)
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def document_chunk_count(job):
    path = f"/v1/default/banks/{quote(BANK, safe='')}/documents/{quote(job['document_id'], safe='')}/chunks?limit=1"
    return int(api(path).get("total") or 0)


def hindsight_documents():
    with DOC_CACHE_LOCK:
        if time.monotonic() - DOC_CACHE["at"] < 15:
            return DOC_CACHE["items"]
        try:
            payload = api(f"/v1/default/banks/{quote(BANK, safe='')}/documents?limit=100")
            items = []
            for doc in payload.get("items", []):
                meta = doc.get("document_metadata") or {}
                docid = doc.get("id", "")
                filename = meta.get("filename") or docid
                try:
                    chunks = document_chunk_count({"document_id": docid})
                except Exception:
                    chunks = 0
                items.append({"id": "hindsight:" + docid, "document_id": docid,
                    "filename": filename, "size": None, "sha256": doc.get("content_hash"),
                    "status": "completed", "progress": 100, "chunks": chunks,
                    "error": None, "created_at": doc.get("created_at", "")})
            DOC_CACHE.update(at=time.monotonic(), items=items)
        except Exception:
            if not DOC_CACHE["items"]:
                raise
        return DOC_CACHE["items"]


def document_status(job):
    if not job.get("operation_id"):
        return
    opid = quote(job["operation_id"], safe="")
    op = api(f"/v1/default/banks/{quote(BANK, safe='')}/operations/{opid}")
    status = ui_status(op.get("status", "queued"))
    prog = op.get("progress") or {}
    done, total = prog.get("processed"), prog.get("total")
    pct = min(99, int(done * 100 / total)) if isinstance(done, int) and isinstance(total, int) and total else (100 if status == "completed" else job["progress"])
    values = {"status": status, "progress": pct, "error": "Hindsight processing failed" if status == "failed" else None}
    if status == "completed":
        values["progress"] = 100
        try:
            values["chunks"] = document_chunk_count(job)
        except Exception:
            pass
    update_job(job["id"], **values)


def watch(jid):
    for _ in range(360):
        time.sleep(2)
        job = get_job(jid)
        if not job or job["status"] in ("failed", "completed"):
            return
        try:
            document_status(job)
        except Exception:
            update_job(jid, error="Hindsight status check failed; verify Hindsight before retrying.")



def submit_file(job, filename, content):
    boundary = "----SB" + uuid.uuid4().hex
    meta = {"files_metadata": [{"document_id": job["document_id"], "context": "Imported through Second Brain Document Manager", "metadata": {"filename": filename, "sha256": job["sha256"], "source": "document-manager"}}]}
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    parts = []
    def field(name, value):
        parts.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode(), value.encode(), b"\r\n"])
    field("request", json.dumps(meta))
    parts.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{filename.replace(chr(34), '')}\"\r\nContent-Type: {mime}\r\n\r\n".encode(), content, b"\r\n", f"--{boundary}--\r\n".encode()])
    body = b"".join(parts)
    req = Request(f"{API}/v1/default/banks/{quote(BANK, safe='')}/files/retain", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"}, method="POST")
    with urlopen(req, timeout=120) as r: result = json.loads(r.read())
    ids = result.get("operation_ids", [])
    if not ids: raise RuntimeError("Hindsight returned no operation ID")
    update_job(job["id"], operation_id=ids[0], status="queued", progress=0, error=None)
    threading.Thread(target=watch, args=(job["id"],), daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    server_version = "SecondBrainDocumentManager/1.0"
    def log_message(self, fmt, *args):
        print("document-manager", self.client_address[0], self.command, urlparse(self.path).path, flush=True)
    def send_json(self, obj, status=200):
        b = json.dumps(obj).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(b))); self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(b)
    def has_session(self):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except Exception:
            return False
        cookie = cookies.get("sb_session")
        return bool(cookie and hmac.compare_digest(cookie.value, SESSION_TOKEN))
    def local_host(self):
        try:
            authority = self.headers.get("Host", "")
            parsed = urlparse("//" + authority)
            port = parsed.port or 80
            server_port = getattr(self.server, "server_port", None)
            return (parsed.hostname is not None and parsed.username is None and parsed.password is None
                and not parsed.path and not parsed.query and not parsed.fragment
                and is_loopback_host(parsed.hostname) and port == server_port)
        except ValueError:
            return False
    def same_origin(self):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        if not origin or not host:
            return False
        try:
            parsed = urlparse(origin)
            return self.local_host() and is_loopback_host(parsed.hostname) and parsed.scheme == "http" and parsed.username is None and parsed.password is None and parsed.netloc.casefold() == host.casefold() and not parsed.path and not parsed.params and not parsed.query and not parsed.fragment
        except ValueError:
            return False
    def do_GET(self):
        p = urlparse(self.path)
        if p.path in ("/", "/index.html"):
            if not self.local_host():
                return self.send_json({"error": "unauthorized"}, 403)
            b = Path(__file__).with_name("index.html").read_bytes()
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(b))); self.send_header("Cache-Control", "no-store")
            self.send_header("Set-Cookie", f"sb_session={SESSION_TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400"); self.end_headers(); return self.wfile.write(b)
        if p.path.startswith("/api/") and (not self.local_host() or not self.has_session()):
            return self.send_json({"error": "unauthorized"}, 403)
        if p.path == "/api/jobs":
            qs = parse_qs(p.query); search = qs.get("q", [""])[0].casefold(); status = qs.get("status", [""])[0]
            with db() as c: rows = [rowdict(r) for r in c.execute("SELECT * FROM jobs ORDER BY created_at DESC")]
            for j in rows:
                if j["status"] == "completed" and j["chunks"] == 0:
                    try:
                        count = document_chunk_count(j)
                        if count:
                            update_job(j["id"], chunks=count)
                            j["chunks"] = count
                    except Exception:
                        pass
            try:
                history = hindsight_documents()
            except Exception:
                history = []
            local_ids = {j["document_id"] for j in rows}
            combined = [j for j in rows]
            combined.extend(d for d in history if d["document_id"] not in local_ids)
            jobs = [j for j in combined if (not search or search in j["filename"].casefold() or search in j["document_id"].casefold()) and (not status or j["status"] == status)]
            return self.send_json({"jobs": jobs, "bank_id": BANK})
        if p.path.startswith("/api/jobs/"):
            j = get_job(p.path.rsplit("/", 1)[-1]); return self.send_json(j or {"error":"not found"}, 200 if j else 404)
        if p.path == "/api/health":
            try: h = api("/health/ready", timeout=4); return self.send_json({"ok": True, "hindsight": h, "bank_id": BANK})
            except Exception: return self.send_json({"ok": False, "error": "Hindsight unavailable"}, 503)
        self.send_json({"error":"not found"},404)
    def do_POST(self):
        p=urlparse(self.path)
        if p.path.startswith("/api/") and (not self.has_session() or not self.same_origin()):
            return self.send_json({"error": "unauthorized"}, 403)
        if p.path == "/api/upload":
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or self.headers.get("Transfer-Encoding"):
                return self.send_json({"error":"Invalid upload length"},400)
            length_text = lengths[0].strip()
            if not length_text.isascii() or not length_text.isdecimal():
                return self.send_json({"error":"Invalid upload length"},400)
            length = int(length_text)
            if length <= 0: return self.send_json({"error":"Empty upload request"},400)
            if length > MAX_BYTES + 2_000_000: return self.send_json({"error":"Upload exceeds configured size limit"},413)
            content_type = self.headers.get("Content-Type", "")
            if content_type.split(";", 1)[0].strip().casefold() != "multipart/form-data":
                return self.send_json({"error":"Expected multipart upload"},400)
            try:
                body = self.rfile.read(length)
                if len(body) != length: return self.send_json({"error":"Incomplete upload request"},400)
                msg=BytesParser(policy=default).parsebytes((f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()+body))
                fileparts=[x for x in msg.iter_parts() if x.get_param("name",header="content-disposition")=="files"]
                if not fileparts: return self.send_json({"error":"No files selected"},400)
                if len(fileparts) > MAX_FILES: return self.send_json({"error":"Too many files in one upload"},413)
                result=[]
                for part in fileparts:
                    name=Path(part.get_filename() or "").name
                    if not name or Path(name).suffix.lower() not in ALLOWED: return self.send_json({"error":f"Unsupported file type: {name}"},400)
                    content=part.get_payload(decode=True) or b""
                    if not content or len(content)>MAX_BYTES: return self.send_json({"error":f"Invalid or oversized file: {name}"},413)
                    digest=hashlib.sha256(content).hexdigest(); job=create_job(name,len(content),digest)
                    created=job.pop("_created",False)
                    if created:
                        try: submit_file(job,name,content)
                        except Exception: update_job(job["id"],status="failed",error="Submission outcome is unknown; verify Hindsight before retrying.")
                    result.append(get_job(job["id"]))
                return self.send_json({"jobs":result},202)
            except Exception: return self.send_json({"error":"Invalid multipart upload"},400)
        if p.path.startswith("/api/jobs/") and p.path.endswith("/retry"):
            jid=p.path.split("/")[-2]; job=get_job(jid)
            if not job: return self.send_json({"error":"not found"},404)
            if job["status"] != "failed" or not job.get("operation_id"): return self.send_json({"error":"Retry requires a failed Hindsight operation; no duplicate upload was sent"},409)
            try:
                api(f"/v1/default/banks/{quote(BANK,safe='')}/operations/{quote(job['operation_id'],safe='')}/retry",method="POST")
                update_job(jid,status="queued",progress=0,error=None); threading.Thread(target=watch,args=(jid,),daemon=True).start()
                return self.send_json(get_job(jid),202)
            except Exception: return self.send_json({"error":"Hindsight retry failed"},502)
        self.send_json({"error":"not found"},404)

if __name__ == "__main__":
    init_db()
    with db() as c:
        active = [r["id"] for r in c.execute("SELECT id FROM jobs WHERE status IN ('queued','processing') AND operation_id IS NOT NULL")]
    for jid in active:
        threading.Thread(target=watch, args=(jid,), daemon=True).start()
    print(f"Second Brain Document Manager on http://{HOST}:{PORT} → Hindsight bank {BANK}", flush=True)
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
