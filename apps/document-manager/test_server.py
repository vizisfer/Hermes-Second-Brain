import importlib.util
import json
import threading
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

MODULE = Path(__file__).with_name("server.py")
spec = importlib.util.spec_from_file_location("document_manager", MODULE)
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

class ManagerStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        app.DB_PATH = Path(self.tmp.name) / "jobs.sqlite3"
        app.init_db()

    def tearDown(self):
        self.tmp.cleanup()

    def test_same_content_returns_existing_job(self):
        digest = "a" * 64
        first = app.create_job("notes.txt", 10, digest)
        second = app.create_job("renamed.txt", 10, digest)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(second["filename"], "notes.txt")

    def test_job_survives_store_reopen(self):
        job = app.create_job("notes.md", 20, "b" * 64)
        app.update_job(job["id"], status="processing", operation_id="op-1")
        app.init_db()
        saved = app.get_job(job["id"])
        self.assertEqual(saved["status"], "processing")
        self.assertEqual(saved["operation_id"], "op-1")




class ManagerHttpAuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        app.DB_PATH = Path(self.tmp.name) / "jobs.sqlite3"
        app.init_db()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.tmp.cleanup()

    def request(self, path, method="GET", headers=None, body=None):
        req = Request(self.base + path, data=body, headers=headers or {}, method=method)
        try:
            return urlopen(req, timeout=2)
        except HTTPError as response:
            return response

    def session_cookie(self):
        response = self.request("/")
        return response.headers.get("Set-Cookie", "").split(";", 1)[0]

    def test_api_jobs_requires_a_session_cookie(self):
        with patch.object(app, "hindsight_documents", return_value=[]):
            response = self.request("/api/jobs")
        self.assertEqual(response.status, 403)

    def test_ui_bootstraps_http_only_strict_session_cookie(self):
        response = self.request("/")
        cookie = response.headers.get("Set-Cookie", "")
        self.assertIn("sb_session=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)

    def test_same_origin_ui_can_read_job_list_with_session_cookie(self):
        cookie = self.session_cookie()
        with patch.object(app, "hindsight_documents", return_value=[]):
            response = self.request("/api/jobs", headers={"Cookie": cookie, "Origin": self.base})
        self.assertEqual(response.status, 200)

    def test_upload_rejects_cross_origin_post_even_with_session_cookie(self):
        cookie = self.session_cookie()
        response = self.request(
            "/api/upload",
            method="POST",
            headers={"Cookie": cookie, "Origin": "http://attacker.invalid", "Content-Type": "multipart/form-data; boundary=test"},
            body=b"",
        )
        self.assertEqual(response.status, 403)

    def test_ui_rejects_non_loopback_host_headers(self):
        response = self.request("/", headers={"Host": "attacker.invalid"})
        self.assertEqual(response.status, 403)
        self.assertIsNone(response.headers.get("Set-Cookie"))

    def test_ui_rejects_loopback_aliases_and_wrong_ports(self):
        port = self.server.server_address[1]
        for host in (f"127.0.0.2:{port}", f"127.0.0.1:{port + 1}"):
            with self.subTest(host=host):
                response = self.request("/", headers={"Host": host})
                self.assertEqual(response.status, 403)

    def test_upload_rejects_matching_origin_on_non_loopback_host(self):
        cookie = self.session_cookie()
        response = self.request(
            "/api/upload",
            method="POST",
            headers={"Cookie": cookie, "Host": "attacker.invalid", "Origin": "http://attacker.invalid", "Content-Type": "multipart/form-data; boundary=test"},
            body=b"",
        )
        self.assertEqual(response.status, 403)

    def test_upload_rejects_malformed_content_length(self):
        cookie = self.session_cookie()
        response = self.request(
            "/api/upload",
            method="POST",
            headers={"Cookie": cookie, "Origin": self.base, "Content-Type": "multipart/form-data; boundary=test", "Content-Length": "invalid"},
            body=b"",
        )
        self.assertEqual(response.status, 400)

    def test_upload_rejects_too_many_file_parts_before_submission(self):
        cookie = self.session_cookie()
        boundary = "test-boundary"
        chunks = []
        for index in range(app.MAX_FILES + 1):
            chunks.extend([
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{index}.txt\"\r\nContent-Type: text/plain\r\n\r\n".encode(),
                b"x\r\n",
            ])
        chunks.append(f"--{boundary}--\r\n".encode())
        with patch.object(app, "submit_file") as submit:
            response = self.request(
                "/api/upload",
                method="POST",
                headers={"Cookie": cookie, "Origin": self.base, "Content-Type": f"multipart/form-data; boundary={boundary}"},
                body=b"".join(chunks),
            )
        self.assertEqual(response.status, 413)
        submit.assert_not_called()

    def test_health_error_does_not_expose_upstream_exception_text(self):
        cookie = self.session_cookie()
        with patch.object(app, "api", side_effect=RuntimeError("credential=secret-value")):
            response = self.request("/api/health", headers={"Cookie": cookie, "Origin": self.base})
        payload = json.loads(response.read())
        self.assertEqual(response.status, 503)
        self.assertEqual(payload["error"], "Hindsight unavailable")
        self.assertNotIn("secret-value", json.dumps(payload))

    def test_status_normalizes_hindsight_pending(self):
        self.assertEqual(app.ui_status("pending"), "queued")
        self.assertEqual(app.ui_status("processing"), "processing")
        self.assertEqual(app.ui_status("completed"), "completed")
        self.assertEqual(app.ui_status("failed"), "failed")

if __name__ == "__main__":
    unittest.main()
