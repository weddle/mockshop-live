import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FixtureTable } from '../core/fixtures.mjs';

test('failed fixture reload preserves the active content and overlay selection', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockshop-fixtures-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'base'));
  fs.mkdirSync(path.join(dir, 'broken'));
  fs.writeFileSync(path.join(dir, 'base', 'data.yaml'), 'GET /company: {name: Acme}\n');
  fs.writeFileSync(path.join(dir, 'broken', 'data.yaml'), 'GET /company: [\n');
  const table = new FixtureTable(dir);
  table.reload();
  assert.throws(() => table.reload(['broken']), /broken[/\\]data\.yaml:/);
  assert.deepEqual(table.overlays, []);
  assert.deepEqual(table.find('GET', '/company').route.val, { name: 'Acme' });
  fs.writeFileSync(path.join(dir, 'broken', 'data.yaml'), 'GET /company: {name: Acme Labs}\n');
  table.reload(['broken']);
  assert.deepEqual(table.find('GET', '/company').route.val, { name: 'Acme Labs' });
});
