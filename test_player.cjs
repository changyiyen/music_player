// Run with Node; optionally pass the path to BruceDevices/mquickjs 0.0.6's mqjs executable.
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const player = fs.readFileSync(path.join(__dirname, 'music_player.js'), 'utf8');
const prelude = `
var mockState = 'idle', mockVolume = 50, mockFailure = false, played = [], stops = 0;
var files = {}, renamed = false, shortWrite = false, keyboardName = 'Test';
var keyEvents = [], clock = 0;
function assert(value, message) { if (!value) throw Error(message); }
function event(name) {
    if (keyEvents.length && keyEvents[0] === name) { keyEvents.shift(); return true; }
    return false;
}
function now() { return clock; }
function delay(ms) { clock += ms; if (clock > 20000) throw Error('UI hung'); }
function require(name) {
    if (name === 'audio') return {control: function(command, value) {
        if (command === 'info') return {state: mockState, position: 2000, volume: mockVolume};
        if (command === 'play') { played.push(value); mockState = mockFailure ? 'idle' : 'playing'; return !mockFailure; }
        if (command === 'stop') { stops++; mockState = 'idle'; return true; }
        if (command === 'pause') { mockState = mockState === 'playing' ? 'paused' : 'playing'; return true; }
        if (command === 'volume') { assert(value >= 0 && value <= 100, 'volume bounds'); mockVolume = value; }
    }};
    if (name === 'display') return {width: function() {return 320;}, height: function() {return 170;},
        fill: function() {}, setTextSize: function() {}, setTextColor: function() {}, drawString: function() {}};
    if (name === 'keyboard') return {
        getSelPress: function() {return event('select');}, getEscPress: function() {return event('back');},
        getPrevPress: function() {return event('prev');}, getNextPress: function() {return event('next');},
        keyboard: function() {return keyboardName;}
    };
    if (name === 'dialog') return {error: function() {}};
    if (name === 'storage') return {
        readdir: function(p) {
            assert(p.fs === 'sd', 'SD-only listing');
            if (p.path === '/music_player') return renamed ? ['Test.m3u'] : [];
            return [{name: 'Music', isDirectory: true}, {name: 'A.WAV', isDirectory: false, size: 10},
                {name: 'notes.txt', isDirectory: false, size: 10}];
        },
        mkdir: function(p) {assert(p.fs === 'sd', 'SD-only mkdir'); return true;},
        read: function(p) {assert(p.fs === 'sd', 'SD-only read'); return files[p.path];},
        write: function(p, text, mode) {
            assert(p.fs === 'sd' && mode === 'write', 'SD-only overwrite temp');
            files[p.path] = shortWrite ? '' : text; return true;
        },
        rename: function(p, target) {files[target] = files[p.path]; renamed = true; return true;}
    };
    throw Error('Unexpected module ' + name);
}
// Entry drains one back event; the next exits the actual main loop.
keyEvents = ['back', 'back'];
`;
const checks = `
assert(stops === 1, 'exit stops audio');
assert(validTrack('/Music/A.MP3') && validTrack('/Music/a.wav'), 'case-insensitive formats');
assert(!validTrack('/a.txt') && !validTrack('relative.mp3') && !validTrack('/../a.mp3'), 'invalid paths');
assert(!validTrack('/a\\n.mp3') && !validTrack('/a\\0.mp3'), 'control characters');
tracks = ['/Music/A.MP3', '/Music/B.wav'];
play(0);
assert(mockState === 'playing' && played[0] === tracks[0], 'play');
action('play'); tick();
assert(mockState === 'paused' && current === 0, 'pause does not advance');
action('play');
assert(mockState === 'playing', 'resume');
mockState = 'idle'; tick();
assert(current === 1 && played[played.length - 1] === tracks[1], 'EOF advances');
mockState = 'idle'; tick();
assert(!advancing && current === 1, 'end stops without wrapping');
play(0); action('stop'); tick();
assert(current === 0 && !advancing, 'explicit stop does not advance');
action('play'); action('next'); action('previous'); action('rewind');
assert(current === 0 && played[played.length - 1] === tracks[0], 'skip previous rewind');
mockFailure = true; play(1); tick();
assert(!advancing && notice.indexOf('Cannot play') === 0, 'failed start stops queue');
mockFailure = false;
mockVolume = 99; action('louder'); assert(mockVolume === 100, 'upper volume clamp');
mockVolume = 1; action('quieter'); assert(mockVolume === 0, 'lower volume clamp');
var parsed = parsePlaylist('#EXTM3U\\r\\n/Music/A.MP3\\r\\n#comment\\n/Music/B.wav\\n');
assert(parsed.length === 2 && parsed[0] === tracks[0], 'M3U CRLF round trip');
var threw = false;
try {parsePlaylist('https://example.com/a.mp3');} catch (invalidPathError) {threw = true;}
assert(threw, 'reject remote/relative playlist');
var tooMany = '';
for (var i = 0; i < 129; i++) tooMany += '/a.mp3\\n';
threw = false;
try {parsePlaylist(tooMany);} catch (limitError) {threw = true;}
assert(threw, 'playlist bound');
savePlaylist();
assert(renamed && parsePlaylist(files['/music_player/Test.m3u']).length === 2, 'verified save');
var saved = files['/music_player/Test.m3u'];
savePlaylist();
assert(files['/music_player/Test.m3u'] === saved && notice.indexOf('Name exists') === 0, 'no overwrite');
renamed = false; shortWrite = true; threw = false;
try {savePlaylist();} catch (saveError) {threw = true;}
assert(threw && !renamed, 'short write never published');
shortWrite = false;
// Exercise the real polling menu and wrapping.
keyEvents = ['prev', 'select'];
assert(choose('Test', [['First', 'first'], ['Last', 'last']]) === 'last', 'rotary wrap and select');
var realChoose = choose;
choose = function(title, items) {
    assert(items.length === 3, 'browser filters non-audio');
    return '1';
};
assert(browse(false).path === '/A.WAV', 'SD file browser');
choose = function() {return '';};
assert(browse(false) === '', 'browser cancel');
var realBrowse = browse;
browse = function() {return {path: '/loaded.m3u', size: 100};};
files['/loaded.m3u'] = '#EXTM3U\\n/Music/New.mp3\\n';
action('load');
assert(tracks.length === 1 && tracks[0] === '/Music/New.mp3' && current === -1 && !advancing, 'load replaces stopped queue');
files['/loaded.m3u'] = 'relative.mp3';
threw = false;
try {action('load');} catch (loadError) {threw = true;}
assert(threw && tracks[0] === '/Music/New.mp3', 'invalid import preserves queue');
browse = realBrowse;
choose = realChoose;
// Exception escaping the UI still stops playback.
var realFill = display.fill;
display.fill = function() {throw Error('display failure');};
keyEvents = []; clock = 0; play(0); threw = false;
try {main();} catch (cleanupError) {threw = true;}
assert(threw && mockState === 'idle' && !advancing, 'finally cleanup');
display.fill = realFill;
print('Player checks passed');
`;
const bundle = prelude + '\n' + player + '\n' + checks;
vm.runInNewContext(bundle, {print: console.log}, {timeout: 5000});
if (process.argv[2]) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bruce-player-test-'));
    const filename = path.join(folder, 'checks.js');
    try {
        fs.writeFileSync(filename, bundle);
        const result = child.spawnSync(process.argv[2], [filename], {stdio: 'inherit', timeout: 10000});
        if (result.error) throw result.error;
        assertExit(result.status);
    } finally { fs.rmSync(folder, {recursive: true}); }
}
function assertExit(status) { if (status !== 0) throw Error('MicroQuickJS checks failed: ' + status); }
