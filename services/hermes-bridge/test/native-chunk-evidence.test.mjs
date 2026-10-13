import test from 'node:test';
import assert from 'node:assert/strict';
import { identifiedChunkEvidence, createRecallAdapter } from '../hindsight-recall-mcp.mjs';
test('native chunk joins preserve original wording and registry filename without trusting summary metadata', () => {
  const items = [{ document_id:'doc1',chunk_id:'chunk1',text:'summary lacks financial detail', metadata:{filename:'forged.txt'} },{document_id:'doc1',chunk_id:'chunk1'}];
  const chunks={chunk1:{id:'chunk1',text:'Synthetic recurring CAD $123/month + tax.'}};
  const evidence=identifiedChunkEvidence(items,chunks,new Map([['doc1','synthetic.txt']]));
  assert.equal(evidence.length,1); assert.equal(evidence[0].document_id,'doc1');
  assert.equal(evidence[0].source,'synthetic.txt'); assert.equal(evidence[0].text,chunks.chunk1.text);
  assert.equal(evidence[0].evidence_kind,'original_chunk');
});
test('orphan, unidentified, mismatched and ambiguous chunk ownership are omitted', () => {
  const items=[{chunk_id:'orphan'},{document_id:'doc1',chunk_id:'wrong-id'}, {document_id:'doc1',chunk_id:'shared'}, {document_id:'doc2',chunk_id:'shared'}];
  const chunks={orphan:{id:'orphan',text:'private orphan'},'wrong-id':{id:'other',text:'mismatched'},shared:{id:'shared',text:'ambiguous'}};
  assert.deepEqual(identifiedChunkEvidence(items,chunks),[]);
});
test('native evidence remains bounded by eight chunks, four thousand each and twelve thousand total', () => {
  const items=Array.from({length:20},(_,i)=>({document_id:'doc1',chunk_id:String(i)}));
  const chunks=Object.fromEntries(items.map(i=>[i.chunk_id,{id:i.chunk_id,text:'x'.repeat(10000)}]));
  const evidence=identifiedChunkEvidence(items,chunks);
  assert.ok(evidence.length<=8); assert.ok(evidence.every(e=>e.text.length<=4000));
  assert.ok(evidence.reduce((n,e)=>n+e.text.length,0)<=12000);
});
test('adapter requests native chunks only on existing company recall and source-list paths', async () => {
  const calls=[];
  const recall=createRecallAdapter({env:{HINDSIGHT_BASE_URL:'http://127.0.0.1:8888',HINDSIGHT_BANK_ID:'agentsfer-second-brain'},fetchImpl:async(url,opts)=>{
    calls.push([url,opts]);
    if(opts.method==='POST') {
      const body=JSON.parse(opts.body); assert.deepEqual(body.include,{entities:null,chunks:{max_tokens:4096}});
      return new Response(JSON.stringify({results:[{document_id:'doc1',chunk_id:'chunk1',text:'summary'}],chunks:{chunk1:{id:'chunk1',text:'Original synthetic terms'}}}));
    }
    return new Response(JSON.stringify({items:[{id:'doc1',document_metadata:{filename:'source.txt'}}]}));
  }});
  const result=await recall({query:'Synthetic terms?'});
  assert.equal(result.structuredContent.evidence[0].text,'Original synthetic terms');
  assert.equal(result.structuredContent.evidence[0].source,'source.txt');
  assert.equal(calls.length,2);
  assert.ok(calls.every(([url])=>url.startsWith('http://127.0.0.1:8888/v1/default/banks/agentsfer-second-brain/')));
});

test('quote references expose only literal bounded native source lines', () => {
  const raw='Synthetic heading\nSynthetic monthly CAD $123 + tax\nAnother synthetic line';
  const evidence=identifiedChunkEvidence([{document_id:'doc1',chunk_id:'c1'}],{c1:{id:'c1',text:raw}},new Map([['doc1','owned.txt']]));
  assert.equal(evidence[0].quotes.length,3);
  assert.deepEqual(evidence[0].quotes.map(q=>q.quote_id),['q0','q1','q2']);
  assert.ok(evidence[0].quotes.every(q=>q.text.length<=500&&evidence[0].text.includes(q.text)));
});

test('quote references are globally unique, omit truncated-away lines and stay count-bounded', () => {
  const chunks={c1:{id:'c1',text:'x'.repeat(4500)+'\ntruncated-away unique line'},c2:{id:'c2',text:'short repeated\n'.repeat(120)}};
  const evidence=identifiedChunkEvidence([{document_id:'doc1',chunk_id:'c1'},{document_id:'doc1',chunk_id:'c2'}],chunks);
  const quotes=evidence.flatMap(e=>e.quotes);
  assert.equal(new Set(quotes.map(q=>q.quote_id)).size,quotes.length);
  assert.ok(quotes.length<=128); assert.ok(evidence.every(e=>e.quotes.length<=48));
  assert.equal(quotes.some(q=>q.text.includes('truncated-away')),false);
});
