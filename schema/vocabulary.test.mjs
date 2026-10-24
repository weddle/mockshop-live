import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { validateVocabulary } from '../core/validate.mjs';

test('operating guide links work without a sample catalog and reject missing targets', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockshop-guides-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const m = {name: 'example', dir};
  const file = path.join(dir, 'vocabulary.yaml');
  const doc = {
    plugin: 'example', version: 1, summary: 'Operating contract',
    surfaces: [{id: 'chat', title: 'Chat', routes: ['/app'], status: 'placeholder', description: 'Chat screen'}],
    actions: [{id: 'send', title: 'Send', surface: 'chat', outcome: 'Prepared reply', guide: 'PLAYBOOK.md#send-a-reply'}],
    moments: [{id: 'reply', title: 'Reply', surface: 'chat', shows: 'Answer text', guide: 'PLAYBOOK.md#reply-state'}],
  };
  fs.writeFileSync(path.join(dir, 'PLAYBOOK.md'), '# Operating guide\n\n## Send a reply\n\n<a id="reply-state"></a>\nState belongs to the chat.\n');
  const result = () => { fs.writeFileSync(file, YAML.stringify(doc)); return validateVocabulary(file, m); };
  assert.equal(result().ok, true);
  doc.actions[0].guide = 'PLAYBOOK.md#absent';
  assert.deepEqual(result().errors.map(e => e.path), ['actions[0].guide']);
  doc.actions[0].guide = 'missing.md';
  assert.deepEqual(result().errors.map(e => e.path), ['actions[0].guide']);
  doc.actions[0].guide = '../private-samples/README.md';
  assert.deepEqual(result().errors.map(e => e.path), ['actions[0].guide']);
});
