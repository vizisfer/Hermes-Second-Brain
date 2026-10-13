import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { issueCapability } from '../../hermes-bridge/test-session-capability.mjs';
const require = createRequire(resolve(import.meta.dirname, '../package.json'));
const { RoomServiceClient } = require('livekit-server-sdk');
const service = new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^wss:/,'https:'),process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET);
const roomName = 'agentsfer-doc-http-test-' + randomUUID();
const room = await service.createRoom({name:roomName,emptyTimeout:120,maxParticipants:2});
try {
  if ((await service.listRooms([roomName]))[0]?.sid !== room.sid) throw new Error('room_readback_failed');
  const payload = { roomSid:room.sid,participantIdentity:'trusted-operator-http-test',question:'Barket teklifinde Economy paketinin aylık fiyatı ve vergisi nedir?' };
  const key=await readFile(process.env.DOCUMENTS_TEST_CAPABILITY_KEY_FILE);
  const capability=issueCapability({key,...payload});
  const headers={authorization:'Bearer '+process.env.HERMES_GATEWAY_TOKEN,'content-type':'application/json','x-document-test-capability':capability};
  const t=performance.now();
  const response=await fetch('https://hermes-api.agentsfer.com/agent/documents-test',{method:'POST',headers,body:JSON.stringify(payload)});
  const result=await response.json();
  const replay=await fetch('https://hermes-api.agentsfer.com/agent/documents-test',{method:'POST',headers,body:JSON.stringify(payload)});
  console.log(JSON.stringify({event:'signed_bridge_document_test',status:response.status,replayStatus:replay.status,
    sources:result.sources||[],answerPresent:typeof result.response==='string'&&result.response.length>0,timingsMs:result.timingsMs,totalMs:Math.round(performance.now()-t),error:result.error}));
  if (response.status!==200||replay.status!==403) process.exitCode=1;
} finally {
  await service.deleteRoom(roomName);
  if((await service.listRooms([roomName])).length!==0) throw new Error('cleanup_readback_failed');
  console.log('controlled_http_test_room_deletion_verified');
}
