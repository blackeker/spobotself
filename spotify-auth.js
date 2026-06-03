require('dotenv').config();
const SpotifyWebApi = require('spotify-web-api-node');
const http = require('http');
const url = require('url');
const fs = require('fs');
const readline = require('readline');

const CACHE_PATH = './.spotifycache';

// Config yükle
const config = {
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    PORT: parseInt(process.env.PORT) || 8888,
    REDIRECT_URI: process.env.REDIRECT_URI || `http://127.0.0.1:${process.env.PORT || 8888}/callback`
};

if (!config.SPOTIFY_CLIENT_ID || !config.SPOTIFY_CLIENT_SECRET) {
    console.error('❌ .env dosyası içinde Spotify API bilgileri eksik!');
    console.log('\nℹ️ Spotify API kimlik bilgilerini almak için:');
    console.log('1. https://developer.spotify.com/dashboard adresine gidin');
    console.log('2. "Create app" tıklayın');
    console.log(`3. Redirect URI: http://127.0.0.1:${config.PORT}/callback`);
    console.log('4. Client ID ve Client Secret bilgilerini .env dosyasına yapıştırın');
    process.exit(1);
}

const spotifyApi = new SpotifyWebApi({
    clientId: config.SPOTIFY_CLIENT_ID,
    clientSecret: config.SPOTIFY_CLIENT_SECRET,
    redirectUri: config.REDIRECT_URI
});

const scopes = [
    'user-read-playback-state',
    'user-read-currently-playing',
    'user-modify-playback-state'
];

console.log('\n🎵 ========================================');
console.log('   Spotify Kimlik Doğrulama Yardımcısı');
console.log('========================================\n');

// Seçenek menüsü
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function showMenu() {
    console.log('Lütfen bir seçenek seçin:\n');
    console.log('1. Otomatik Yetkilendirme (Tarayıcı + Yerel Server)');
    console.log('2. Manuel Yetkilendirme (URL kopyala/yapıştır)');
    console.log('3. Çıkış\n');

    rl.question('Seçiminiz (1-3): ', (answer) => {
        switch (answer.trim()) {
            case '1':
                automaticAuth();
                break;
            case '2':
                manualAuth();
                break;
            case '3':
                console.log('👋 Çıkılıyor...');
                rl.close();
                process.exit(0);
                break;
            default:
                console.log('⚠️ Geçersiz seçim!\n');
                showMenu();
        }
    });
}

// ==================== OTOMATIK YETKİLENDİRME ====================
function automaticAuth() {
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes, 'state');
    
    console.log('\n🌐 Tarayıcınızda yetkilendirme sayfası açılıyor...');
    console.log('📋 Açılmazsa bu linki manuel olarak açın:');
    console.log(authorizeURL + '\n');

    // Tarayıcıda aç
    const start = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
    require('child_process').exec(`${start} "${authorizeURL}"`);

    // Yerel server başlat
    const server = http.createServer(async (req, res) => {
        const queryData = url.parse(req.url, true).query;

        if (queryData.code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>Yetkilendirme Başarılı</title>
                    <style>
                        body {
                            font-family: 'Segoe UI', Arial, sans-serif;
                            background: linear-gradient(135deg, #1DB954, #191414);
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            color: white;
                        }
                        .container {
                            text-align: center;
                            background: rgba(0,0,0,0.7);
                            padding: 40px;
                            border-radius: 15px;
                            box-shadow: 0 10px 50px rgba(0,0,0,0.5);
                        }
                        h1 { color: #1DB954; margin-bottom: 20px; }
                        p { font-size: 18px; margin: 10px 0; }
                        .check { font-size: 64px; animation: bounce 0.6s; }
                        @keyframes bounce {
                            0%, 100% { transform: scale(1); }
                            50% { transform: scale(1.2); }
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="check">✅</div>
                        <h1>Yetkilendirme Başarılı!</h1>
                        <p>Spotify hesabınız başarıyla bağlandı.</p>
                        <p>Bu pencereyi kapatabilirsiniz.</p>
                        <p style="margin-top: 30px; color: #888;">Konsol penceresine geri dönün...</p>
                    </div>
                </body>
                </html>
            `);

            try {
                const data = await spotifyApi.authorizationCodeGrant(queryData.code);
                
                const cache = {
                    access_token: data.body.access_token,
                    refresh_token: data.body.refresh_token,
                    expires_in: data.body.expires_in,
                    timestamp: Date.now()
                };

                fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
                
                console.log('\n✅ Yetkilendirme başarılı!');
                console.log('📝 Token bilgileri .spotifycache dosyasına kaydedildi');
                console.log('\n🚀 Artık "npm start" komutu ile botu başlatabilirsiniz!\n');
                
                setTimeout(() => {
                    server.close();
                    rl.close();
                    process.exit(0);
                }, 2000);
            } catch (err) {
                console.error('\n❌ Token alma hatası:', err.message);
                server.close();
                rl.close();
                process.exit(1);
            }
        } else if (queryData.error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>❌ Yetkilendirme Reddedildi</h1><p>Konsol penceresine geri dönün.</p>');
            
            console.error('\n❌ Yetkilendirme reddedildi veya iptal edildi');
            server.close();
            rl.close();
            process.exit(1);
        }
    });

    server.listen(config.PORT, () => {
        console.log(`🔄 Yerel server başlatıldı (http://127.0.0.1:${config.PORT})`);
        console.log('⏳ Yetkilendirme bekleniyor...\n');
    });
}

// ==================== MANUEL YETKİLENDİRME ====================
function manualAuth() {
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes, 'state');
    
    console.log('\n📋 Aşağıdaki URL\'i tarayıcınıza kopyalayıp yapıştırın:\n');
    console.log(authorizeURL);
    console.log('\n▶️ Yetkilendirme sonrası yönlendirilen URL\'deki "code=" parametresini kopyalayın\n');
    console.log(`Örnek: http://127.0.0.1:${config.PORT}/callback?code=BURASI_KOD&state=state\n`);

    rl.question('Authorization Code: ', async (code) => {
        if (!code || code.trim().length === 0) {
            console.error('❌ Geçersiz kod!');
            rl.close();
            process.exit(1);
        }

        try {
            console.log('\n🔄 Token alınıyor...');
            const data = await spotifyApi.authorizationCodeGrant(code.trim());
            
            const cache = {
                access_token: data.body.access_token,
                refresh_token: data.body.refresh_token,
                expires_in: data.body.expires_in,
                timestamp: Date.now()
            };

            fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
            
            console.log('\n✅ Yetkilendirme başarılı!');
            console.log('📝 Token bilgileri .spotifycache dosyasına kaydedildi');
            console.log('\n🚀 Artık "npm start" komutu ile botu başlatabilirsiniz!\n');
            
            rl.close();
            process.exit(0);
        } catch (err) {
            console.error('\n❌ Token alma hatası:', err.message);
            console.log('\n⚠️ Olası nedenler:');
            console.log('- Kod geçersiz veya süresi dolmuş');
            console.log('- Redirect URI .env dosyasında yanlış');
            console.log('- Spotify API ayarları hatalı\n');
            
            rl.close();
            process.exit(1);
        }
    });
}

// Başlat
showMenu();