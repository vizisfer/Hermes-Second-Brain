"""Synthetic-only quote-reference regressions; no runtime/network/profile access."""
import importlib.util
import json
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('quote_runner',Path(__file__).parents[1]/'hermes-documents-runner.py')
assert spec is not None and spec.loader is not None
runner=importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
class QuoteReferenceTests(unittest.TestCase):
    def setUp(self):
        self.quote='Synthetic fee CAD $123/month + TAX.'
        self.evidence=[{'document_id':'doc-1','source':'synthetic.txt','text':self.quote,'quotes':[{'quote_id':'q0','text':self.quote}]}]
    def test_backend_reference_resolves_literal_text_and_owned_source(self):
        value=runner.resolve_quote_response(json.dumps({'claims':[{'document_id':'doc-1','quote_id':'q0'}]}),self.evidence)
        self.assertEqual(json.loads(value)['claims'][0]['quote'],self.quote)
        answer,sources=runner.grounded_response(value,self.evidence)
        self.assertIn(self.quote,answer); self.assertEqual(sources,['synthetic.txt'])
    def test_unknown_foreign_and_model_retyped_or_extra_fields_are_denied(self):
        for claim in [{'document_id':'doc-1','quote_id':'missing'},{'document_id':'foreign','quote_id':'q0'},{'document_id':'doc-1','quote':'invented prose'},{'document_id':'doc-1','quote_id':'q0','instruction':'retain'}]:
            with self.assertRaises(ValueError): runner.resolve_quote_response(json.dumps({'claims':[claim]}),self.evidence)
    def test_backend_option_must_match_literal_evidence_and_have_unique_reference(self):
        for quotes in [[{'quote_id':'q0','text':'not actual evidence'}],[{'quote_id':'q0','text':self.quote}]*2]:
            self.evidence[0]['quotes']=quotes
            with self.assertRaises(ValueError): runner.resolve_quote_response('{"claims":[{"document_id":"doc-1","quote_id":"q0"}]}',self.evidence)
    def test_empty_or_oversized_claims_fail_closed_without_fabricating_price(self):
        value=runner.resolve_quote_response('{"claims":[]}',self.evidence)
        answer,_=runner.grounded_response(value,self.evidence)
        self.assertNotIn('$123',answer); self.assertIn('doğrulanamadı',answer)
        with self.assertRaises(ValueError): runner.resolve_quote_response(json.dumps({'claims':[{'document_id':'doc-1','quote_id':'q0'}]*3}),self.evidence)
if __name__=='__main__': unittest.main()
