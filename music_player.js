// Bruce / LilyGO T-Embed CC1101. Requires the accompanying audio.control binding.
var audio = require('audio');
var display = require('display');
var keys = require('keyboard');
var storage = require('storage');
var dialog = require('dialog');

var tracks = [];
var current = -1;
var advancing = false;
var notice = '';
var width = display.width();
var height = display.height();
// ponytail: bounded playlists keep the handheld's JS heap small; raise after device profiling.
var MAX_TRACKS = 128;
var SAVE_DIR = '/music_player';

function sd(path) { return {fs: 'sd', path: path}; }
function basename(path) { return path.slice(path.lastIndexOf('/') + 1); }
function isAudio(path) {
    var ext = path.slice(-4).toLowerCase();
    return ext === '.wav' || ext === '.mp3';
}
function validTrack(path) {
    return typeof path === 'string' && path.charAt(0) === '/' &&
        path.indexOf('\n') < 0 && path.indexOf('\r') < 0 && path.indexOf('\0') < 0 &&
        path.indexOf('/../') < 0 && isAudio(path);
}
function stop() {
    advancing = false;
    audio.control('stop');
}
function play(index) {
    if (index < 0 || index >= tracks.length) return;
    stop();
    current = index;
    if (audio.control('play', tracks[current])) {
        advancing = true;
        notice = '';
    } else {
        notice = 'Cannot play: check file and Sound setting';
    }
}
function tick() {
    var info = audio.control('info');
    if (advancing && info.state === 'idle') {
        advancing = false;
        if (current + 1 < tracks.length) play(current + 1);
        else notice = 'Playlist finished';
        info = audio.control('info');
    } else if (info.state === 'error') {
        advancing = false;
        notice = 'Audio error; select another track';
    }
    return info;
}
function line(text, y, color) {
    display.setTextColor(color);
    display.drawString(text.slice(0, Math.floor((width - 12) / 6)), 6, y);
}
// Every menu polls playback, including the browser, so EOF can advance the queue.
function choose(title, items, initial) {
    var selected = initial || 0;
    var dirty = true;
    var lastDraw = 0;
    var rows = Math.max(1, Math.floor((height - 90) / 16));
    delay(220);
    keys.getSelPress();
    keys.getEscPress();
    while (true) {
        var info = tick();
        if (keys.getEscPress()) return '';
        if (keys.getPrevPress()) {
            selected = (selected + items.length - 1) % items.length;
            dirty = true;
        }
        if (keys.getNextPress()) {
            selected = (selected + 1) % items.length;
            dirty = true;
        }
        if (keys.getSelPress()) return items[selected][1];
        if (dirty || now() - lastDraw >= 250) {
            display.fill(0);
            display.setTextSize(1);
            line(title, 4, 0x07ff);
            line(current >= 0 ? (current + 1) + '/' + tracks.length + ' ' + basename(tracks[current]) : 'No track selected', 20, 0xffff);
            var seconds = Math.floor(info.position / 1000);
            line(info.state + '  ' + Math.floor(seconds / 60) + ':' + (seconds % 60 < 10 ? '0' : '') + seconds % 60 + '  Vol ' + info.volume + '%', 36, 0xffff);
            var first = Math.floor(selected / rows) * rows;
            for (var i = first; i < Math.min(first + rows, items.length); i++) {
                line((i === selected ? '> ' : '  ') + items[i][0], 56 + (i - first) * 16, i === selected ? 0xffe0 : 0xffff);
            }
            line(notice || 'Rotate: select  Click: OK  Back: exit', height - 16, notice ? 0xffe0 : 0x7bef);
            lastDraw = now();
            dirty = false;
        }
        delay(30);
    }
}
function browse(playlists) {
    var folder = '/';
    while (true) {
        var entries = storage.readdir(sd(folder), {withFileTypes: true});
        entries.sort(function(a, b) {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        var items = [['Cancel', 'cancel']];
        if (folder !== '/') items.push(['[..]', 'up']);
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry.isDirectory || (playlists ? entry.name.slice(-4).toLowerCase() === '.m3u' : isAudio(entry.name))) {
                items.push([(entry.isDirectory ? '[DIR] ' : '') + entry.name, String(i)]);
            }
        }
        var selected = choose('SD ' + folder, items);
        if (selected === '' || selected === 'cancel') return '';
        if (selected === 'up') {
            folder = folder.slice(0, folder.lastIndexOf('/')) || '/';
        } else {
            var chosen = entries[Number(selected)];
            var path = (folder === '/' ? '' : folder) + '/' + chosen.name;
            if (chosen.isDirectory) folder = path;
            else return {path: path, size: chosen.size};
        }
    }
}
function parsePlaylist(text) {
    var result = [];
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
        var path = lines[i];
        if (path.slice(-1) === '\r') path = path.slice(0, -1);
        if (path === '' || path.charAt(0) === '#') continue;
        if (!validTrack(path)) throw Error('M3U needs absolute SD WAV/MP3 paths');
        if (result.length === MAX_TRACKS) throw Error('Playlist limit: 128 tracks');
        result.push(path);
    }
    if (!result.length) throw Error('Playlist is empty');
    return result;
}
function savePlaylist() {
    if (!tracks.length) { notice = 'Add tracks before saving'; return; }
    var name = keys.keyboard('', 32, 'New playlist name');
    if (!name) return;
    for (var i = 0; i < name.length; i++) {
        if ('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-'.indexOf(name.charAt(i)) < 0) {
            notice = 'Name: letters, numbers, spaces, _ or -';
            return;
        }
    }
    if (!storage.mkdir(sd(SAVE_DIR))) throw Error('Cannot create playlist folder');
    var filename = name + '.m3u';
    if (storage.readdir(sd(SAVE_DIR)).indexOf(filename) >= 0) {
        notice = 'Name exists; use a new playlist name';
        return;
    }
    var destination = SAVE_DIR + '/' + filename;
    var temporary = destination + '.tmp';
    var text = '#EXTM3U\n' + tracks.join('\n') + '\n';
    // Bruce storage.write reports open success, so verify the complete write before renaming.
    if (!storage.write(sd(temporary), text, 'write') || storage.read(sd(temporary)) !== text ||
        !storage.rename(sd(temporary), destination)) throw Error('Playlist save failed; check SD space');
    notice = 'Saved ' + filename;
}
function action(command) {
    var file;
    if (command === 'open' || command === 'add') {
        if (tracks.length >= MAX_TRACKS) { notice = 'Playlist limit: 128 tracks'; return; }
        file = browse(false);
        if (!file) return;
        if (!validTrack(file.path)) throw Error('Unsupported filename');
        tracks.push(file.path);
        notice = 'Added ' + basename(file.path);
        if (command === 'open') play(tracks.length - 1);
    } else if (command === 'play') {
        var info = audio.control('info');
        if (info.state === 'playing' || info.state === 'paused') audio.control('pause');
        else if (tracks.length) play(current < 0 ? 0 : current);
        else notice = 'Open a file or add tracks first';
    } else if (command === 'stop') {
        stop();
        notice = 'Stopped';
    } else if (command === 'next' || command === 'previous') {
        var next = current + (command === 'next' ? 1 : -1);
        if (next >= 0 && next < tracks.length) play(next);
        else notice = 'End of playlist';
    } else if (command === 'rewind') {
        play(current);
    } else if (command === 'louder' || command === 'quieter') {
        var volume = audio.control('info').volume;
        var target = Math.max(0, Math.min(100, volume + (command === 'louder' ? 5 : -5)));
        if (target !== volume) audio.control('volume', target);
    } else if (command === 'queue') {
        var items = [['Back', 'back']];
        for (var i = 0; i < tracks.length; i++) items.push([(i + 1) + '. ' + basename(tracks[i]), String(i)]);
        var picked = choose('Playlist: select to play', items);
        if (picked !== '' && picked !== 'back') play(Number(picked));
    } else if (command === 'clear') {
        if (choose('Clear current playlist?', [['Keep', 'keep'], ['Clear', 'yes']]) === 'yes') {
            stop();
            tracks = [];
            current = -1;
            notice = 'Playlist cleared';
        }
    } else if (command === 'save') {
        savePlaylist();
    } else if (command === 'load') {
        file = browse(true);
        if (!file) return;
        if (file.size > 32768) throw Error('M3U limit: 32 KB');
        var loaded = parsePlaylist(storage.read(sd(file.path)));
        stop();
        tracks = loaded;
        current = -1;
        notice = 'Playlist loaded; press Play';
    }
}
function main() {
    if (typeof audio.control !== 'function') {
        dialog.error('Install music_player firmware binding first', true);
        return;
    }
    var menu = [
        ['Open SD file and play', 'open'], ['Play / Pause', 'play'], ['Stop', 'stop'],
        ['Skip to next track', 'next'], ['Rewind to start', 'rewind'], ['Previous track', 'previous'],
        ['Volume +5%', 'louder'], ['Volume -5%', 'quieter'], ['Add SD file to playlist', 'add'],
        ['View playlist', 'queue'], ['Save playlist', 'save'], ['Load playlist', 'load'],
        ['Clear playlist', 'clear'], ['Exit', 'exit']
    ];
    var selected = 0;
    try {
        while (true) {
            var command = choose('BRUCE MUSIC PLAYER', menu, selected);
            if (command === '' || command === 'exit') break;
            for (var i = 0; i < menu.length; i++) {
                if (menu[i][1] === command) selected = i;
            }
            try { action(command); }
            catch (error) { notice = String(error); }
        }
    } finally {
        stop();
    }
}
main();
