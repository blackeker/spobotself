require('dotenv').config();
const { Client, RichPresence } = require('discord.js-selfbot-v13');
const SpotifyWebApi = require('spotify-web-api-node');
const axios = require('axios');
const fs = require('fs');
const http = require('http');

// ==================== WEB SERVER (FOR VERCEL/HOSTING) ====================
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Spotify RPC Bot Çalışıyor! 🚀');
}).listen(process.env.PORT || 8888, () => {
    console.log(`🌐 Web sunucusu ${process.env.PORT || 8888} portunda başlatıldı.`);
});

// ==================== CONFIG LOADER ====================
const CACHE_PATH = './.spotifycache';

const CONFIG = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    APPLICATION_ID: process.env.APPLICATION_ID || "1123893835773263934",
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    PORT: parseInt(process.env.PORT) || 8888,
    REDIRECT_URI: process.env.REDIRECT_URI || `http://127.0.0.1:${process.env.PORT || 8888}/callback`,
    DETAILS_PREFIX: process.env.DETAILS_PREFIX || "♪",
    DETAILS_PREFIX_NO_LYRICS: process.env.DETAILS_PREFIX_NO_LYRICS || "Söz Yok",
    STATE_FORMAT: process.env.STATE_FORMAT || "{name} — {artist}",
    BUTTON_1_LABEL: process.env.BUTTON_1_LABEL || "Şarkıyı Dinle",
    BUTTON_2_LABEL: process.env.BUTTON_2_LABEL || "Geliştirici",
    BUTTON_2_URL: process.env.BUTTON_2_URL || "https://github.com/blackeker",
    UPDATE_INTERVAL: parseInt(process.env.UPDATE_INTERVAL) || 2000,
    LYRICS_TIMEOUT: parseInt(process.env.LYRICS_TIMEOUT) || 10000,
};

// ==================== VALIDATION ====================
if (!CONFIG.DISCORD_TOKEN || !CONFIG.SPOTIFY_CLIENT_ID || !CONFIG.SPOTIFY_CLIENT_SECRET) {
    console.error('❌ HATA: Gerekli yapılandırma (TOKEN, SPOTIFY ID/SECRET) eksik!');
    process.exit(1);
}

// ==================== SPOTIFY API ====================
const spotifyApi = new SpotifyWebApi({
    clientId: CONFIG.SPOTIFY_CLIENT_ID,
    clientSecret: CONFIG.SPOTIFY_CLIENT_SECRET,
    redirectUri: CONFIG.REDIRECT_URI
});

let spotifyTokenExpiry = 0;

async function refreshSpotifyToken() {
    try {
        if (!fs.existsSync(CACHE_PATH)) {
            console.log('🔐 Spotify kimlik doğrulaması gerekiyor...');
            const authorizeURL = spotifyApi.createAuthorizeURL(['user-read-playback-state', 'user-read-currently-playing'], 'state');
            console.log('Lütfen bu URL\'yi tarayıcınızda açın ve yetkilendirme yapın:', authorizeURL);
            console.log('\n⚠️ Yetkilendirme sonrası dönen URL\'yi kullanarak spotify-auth.js\'i çalıştırın.');
            process.exit(0);
        }

        const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        spotifyApi.setRefreshToken(cache.refresh_token);

        if (Date.now() >= spotifyTokenExpiry - 60000) {
            const data = await spotifyApi.refreshAccessToken();
            spotifyApi.setAccessToken(data.body.access_token);
            spotifyTokenExpiry = Date.now() + (data.body.expires_in * 1000);
            console.log('✅ Spotify token yenilendi.');
        }
    } catch (err) {
        console.error('❌ Spotify token hatası:', err.message);
        if (err.statusCode === 400) {
            console.log('⚠️ Cache geçersiz. Lütfen .spotifycache dosyasını silip yeniden yetkilendirme yapın.');
            if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
        }
    }
}

// ==================== LYRICS HELPER ====================
const lyricsCache = new Map();

async function getLyrics(trackName, artistName, duration) {
    const cacheKey = `${trackName}_${artistName}_${duration}`;
    if (lyricsCache.has(cacheKey)) return lyricsCache.get(cacheKey);

    try {
        const params = new URLSearchParams({ title: trackName, artist: artistName });
        const { data } = await axios.get(`https://www.yusufkaymaz.com.tr/api/lyrics?${params}`, { timeout: CONFIG.LYRICS_TIMEOUT });

        if (data && data.syncedLyrics) {
            const lyrics = parseLRC(data.syncedLyrics);
            if (lyrics.length > 0) {
                console.log(`✅ "${trackName}" için senkronize şarkı sözü bulundu (Yusuf Kaymaz API).`);
                lyricsCache.set(cacheKey, lyrics);
                return lyrics;
            }
        }
    } catch (error) {
        if (error.response?.status !== 404) console.warn(`⚠️ Şarkı sözü alınırken hata: ${error.message}`);
    }
    
    console.log(`⭕ "${trackName}" için şarkı sözü bulunamadı.`);
    lyricsCache.set(cacheKey, null);
    return null;
}

function parseLRC(lrcText) {
    return lrcText.split('\n').map(line => {
        const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
        if (match) {
            const [, minutes, seconds, centiseconds, text] = match;
            if (text.trim()) {
                return { time: parseInt(minutes) * 60 + parseInt(seconds) + parseInt(centiseconds) / 100.0, text: text.trim() };
            }
        }
        return null;
    }).filter(Boolean);
}

function findCurrentLyric(lyrics, progress) {
    if (!lyrics || lyrics.length === 0) return CONFIG.DETAILS_PREFIX_NO_LYRICS;
    
    let currentLyric = lyrics[0].text;
    for (const line of lyrics) {
        if (progress >= line.time) currentLyric = line.text;
        else break;
    }
    return `${CONFIG.DETAILS_PREFIX} ${currentLyric}`;
}

// ==================== DISCORD CLIENT ====================
const client = new Client({ checkUpdate: false });
let currentTrackId = null;
let currentLyrics = null;

async function updatePresence() {
    let item = null;
    let presence = null;
    
    try {
        await refreshSpotifyToken();
        const { body: track } = await spotifyApi.getMyCurrentPlayingTrack();

        if (!track || !track.is_playing || !track.item) {
            if (currentTrackId) {
                client.user.setActivity(null);
                currentTrackId = null;
                currentLyrics = null;
                console.log('▶️ Müzik durdu, RPC temizlendi.');
            }
            return;
        }

        item = track.item;
        
        if (item.id !== currentTrackId) {
            console.log(`\n🎵 Yeni şarkı: ${item.artists[0].name} - ${item.name}`);
            currentTrackId = item.id;
            const duration = item.duration_ms / 1000;
            currentLyrics = await getLyrics(item.name, item.artists[0].name, duration);
        }
        
        const progress = track.progress_ms / 1000;
        const details = findCurrentLyric(currentLyrics, progress);
        const state = CONFIG.STATE_FORMAT
            .replace('{name}', item.name)
            .replace('{artist}', item.artists.map(a => a.name).join(', '));

        // Spotify albüm ID'sini al (URL'den son kısmı çıkar)
        let albumArtId = 'spotify';
        if (item.album.images && item.album.images.length > 0) {
            const urlParts = item.album.images[0].url.split('/');
            albumArtId = 'spotify:' + urlParts[urlParts.length - 1];
        }

        presence = new RichPresence(client)
            .setApplicationId(CONFIG.APPLICATION_ID)
            .setType('LISTENING')
            .setName('Spotify')
            .setDetails(details.substring(0, 128))
            .setState(state.substring(0, 128))
            .setAssetsLargeImage(albumArtId)
            .setAssetsLargeText(item.album.name)
            .setAssetsSmallImage('https://cdn.discordapp.com/emojis/1107334222996443186.gif')
            .setAssetsSmallText('Spotify')
            .setButtons([
                { name: CONFIG.BUTTON_1_LABEL, url: item.external_urls.spotify },
                { name: CONFIG.BUTTON_2_LABEL, url: CONFIG.BUTTON_2_URL }
            ]);
        
        client.user.setActivity(presence);
        
        // Durum logu
        const progressMin = Math.floor(progress / 60);
        const progressSec = Math.floor(progress % 60).toString().padStart(2, '0');
        process.stdout.write(`\r📡 Durum: ${item.artists[0].name} - ${item.name} [${progressMin}:${progressSec}] | RPC Güncellendi...   `);

    } catch (err) {
        console.error('❌ Ana döngüde hata:', err.message);
        if (item) {
            console.log('Albüm resimleri:', item.album?.images);
        }
        if (err.stack) {
            console.error('Stack:', err.stack);
        }
    }
}
// ==================== EVENTS ====================
client.on('ready', async () => {
    console.log('\n🚀 ====================================');
    console.log(`✅ Discord'a giriş yapıldı: ${client.user.tag}`);
    console.log('📡 Bot Durumu: Aktif - Spotify Verileri Bekleniyor...');
    console.log('====================================\n');
    
    await refreshSpotifyToken();
    updatePresence();
    setInterval(updatePresence, CONFIG.UPDATE_INTERVAL);
});

client.on('error', (err) => {
    console.error('❌ Discord hatası:', err.message);
});

process.on('SIGINT', () => {
    console.log('\n\n👋 Kapatılıyor...');
    try {
        client.user.setActivity(null);
    } finally {
        client.destroy();
        process.exit(0);
    }
});

// ==================== START ====================
console.log('🔄 Discord bağlantısı kuruluyor...');
client.login(CONFIG.DISCORD_TOKEN).catch(err => {
    console.error('❌ Discord giriş hatası:', err.message);
    if (err.message.includes('TOKEN_INVALID')) {
        console.log('ℹ️ Lütfen .env dosyasındaki DISCORD_TOKEN değerini kontrol edin.');
    }
    process.exit(1);
});