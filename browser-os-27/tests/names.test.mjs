import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitExtension, splitName } from '../src/core/utils.js';

/**
 * Name truncation, tested without a browser.
 *
 * Files cuts long names with a CSS ellipsis, which eats the end of a name — and for a file
 * the end is the extension, the one part of the name that is not the author's choice.
 * `splitExtension` hands the layout a head it may cut and a tail it must keep. The rule for
 * when *not* to split matters as much as the rule for when to: a split that buys nothing is
 * a second shape a name can have for no reason.
 */

test('a long name with an extension keeps the extension', () => {
  const { head, tail } = splitExtension('2024-06-30-team-retrospective-notes-final.tar.gz');
  assert.equal(head, '2024-06-30-team-retrospective-notes-final');
  assert.equal(tail, '.tar.gz');
  assert.equal(head + tail, '2024-06-30-team-retrospective-notes-final.tar.gz', 'splitting must not lose a character');
});

test('a short name is not split: nothing would have been cut anyway', () => {
  const name = 'notes.md';
  const { head, tail } = splitExtension(name);
  assert.equal(head, name);
  assert.equal(tail, '', 'a plain name stays one piece of text');
});

test('a chain of dotted words is not an extension', () => {
  const name = 'Makefile.build.target.thing.that.is.long.enough.to.split';
  const { head, tail } = splitExtension(name);
  assert.equal(tail, '', 'protecting 45 characters of "extension" would hide the part that identifies the file');
  assert.equal(head, name);
});

test('a name with no extension is not split', () => {
  const noDot = splitExtension('README');
  assert.equal(noDot.head, 'README');
  assert.equal(noDot.tail, '');
  const longNoDot = splitExtension('a-folder-name-with-no-dot-anywhere-and-long-enough-to-cut');
  assert.equal(longNoDot.tail, '', 'there is nothing here worth protecting more than the beginning');
});

test('a compound extension is kept whole', () => {
  const name = 'archive-2024-06-30-backup.tar.zst';
  const { head, tail } = splitExtension(name);
  assert.equal(tail, '.tar.zst', 'cutting it to `.zst` protects the wrong half');
  assert.equal(head + tail, name);
});

test('a dotfile is a whole name, not an extension', () => {
  const { head, tail } = splitExtension('.gitignore-because-somebody-likes-long-names');
  assert.equal(tail, '', 'splitting at the leading dot would keep the name and cut its beginning');
  assert.ok(head.startsWith('.gitignore'));
});

test('something too long to be an extension is not protected', () => {
  const { head, tail } = splitExtension('a-very-long-folder-name.with-an-absurdly-long-suffix');
  assert.equal(tail, '', 'a 30-character "extension" is the name, and protecting it hides the part that identifies the file');
  assert.equal(head, 'a-very-long-folder-name.with-an-absurdly-long-suffix');
});

test('every split is lossless', () => {
  const names = [
    'a.tar.gz', 'archive.2024-06-30.tar.zst', 'photo.PNG', '.hidden.txt', 'no-extension-at-all',
    'x.y', 'a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s-t-u-v-w-x-y-z.md', '', '.', '..', 'a.',
  ];
  for (const name of names) {
    const { head, tail } = splitExtension(name);
    assert.equal(head + tail, name, `splitting ${JSON.stringify(name)} lost characters`);
    assert.ok(tail === '' || tail.startsWith('.'), `the tail must be the extension, got ${JSON.stringify(tail)}`);
  }
});

/**
 * `splitName` is the same mechanism pointed at a name with no extension — a folder in the
 * breadcrumb, a file on the desktop. The interesting assertions are the negative ones: a tail
 * is only worth protecting when it is a word rather than a fragment, and when it fits in the
 * narrow box alongside a beginning (see tests/measure-crumb.mjs for the widths).
 */
test('a folder name keeps its trailing marker', () => {
  const { head, tail } = splitName('release-2024-06-30-final');
  assert.equal(tail, '-final', 'the delimiter belongs to the tail, as it does for `.tar.gz`');
  assert.equal(head + tail, 'release-2024-06-30-final');
});

test('a numeric fragment is not a marker', () => {
  /* `old-notes-2024-06-30` ends in a date, not in a label: protecting `30` or `06-30` hides
     the part of the name that identifies it and protects two characters nobody looks for. */
  const { head, tail } = splitName('old-notes-2024-06-30');
  assert.equal(tail, '');
  assert.equal(head, 'old-notes-2024-06-30');
});

test('a long trailing word is not protected: it would eat the whole collapsed box', () => {
  /* The collapsed crumb is 12ch ≈ 70px of text. A 13-character tail measured 74px and left
     the head at zero width — the beginning, the one part of a name people recognise, gone. */
  const { head, tail } = splitName('2024-06-30-team-retrospective');
  assert.equal(tail, '', 'a 13-character tail is the middle of the name, not a marker');
  assert.equal(head, '2024-06-30-team-retrospective');
});

test('a folder whose name has an extension-looking end keeps the part that fits', () => {
  const name = 'a-very-long-folder-name.with-an-absurdly-long-suffix';
  const { head, tail } = splitName(name);
  /* The extension rule refuses a 30-character suffix; the component rule then protects the
     only part of it that fits a narrow box. */
  assert.equal(tail, '-suffix');
  assert.equal(head + tail, name);
  assert.ok(head.length >= 8, 'the beginning is still there');
});

test('names nobody would ever truncate are not split into pieces', () => {
  for (const name of ['notes', 'my_folder', 'short-name.md', 'a-fairly-short-name', 'release-final']) {
    const { head, tail } = splitName(name);
    assert.equal(tail, '', `${name} was split for no reason`);
    assert.equal(head, name);
  }
});

test('a name with no delimiter at all is left to the ellipsis', () => {
  const name = 'extraordinarilylongfoldernameonewordwithnohyphensatall';
  const { head, tail } = splitName(name);
  assert.equal(tail, '', 'there is no structure here to respect');
  assert.equal(head, name);
});

test('splitName is lossless and never leaves the head empty', () => {
  const names = [
    'release-2024-06-30-final', 'a-folder-name-long-enough-to-cost-the-bar-room',
    'backup_before_migration_old', 'some.thing.that-goes-on.for.a.while.final',
    'twenty-char-name-here!', 'a-bcd', 'abcdef-gh', 'x-y-z-long-enough-here-final',
    '日本語のフォルダ名前です', '', 'a-', '-final-suffix-name-here',
  ];
  for (const name of names) {
    const { head, tail } = splitName(name);
    assert.equal(head + tail, name, `splitting ${JSON.stringify(name)} lost characters`);
    if (tail) {
      assert.ok(tail.length <= 9, `a ${tail.length}-character tail would fill the collapsed box`);
      assert.ok(head.length >= 6, `the head of ${JSON.stringify(name)} was reduced to nothing`);
    }
  }
});

test('splitName keeps an extension when there is one (it is the same mechanism, not a second one)', () => {
  const { head, tail } = splitName('2024-06-30-team-retrospective-notes-final.tar.gz');
  assert.equal(tail, '.tar.gz');
  assert.equal(head, '2024-06-30-team-retrospective-notes-final');
});
