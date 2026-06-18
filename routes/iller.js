const express = require('express');
const db = require('../database/db');
const { tokenDogrula, adminVeyaYardimci } = require('../middleware/auth');
const { kayitFormatla } = require('../middleware/format');
const router = express.Router();

// Bir kullanicinin gorebilecegi il id'lerini dondurur
function kullanicininIlleri(kullaniciId) {
    return db.prepare('SELECT il_id FROM kullanici_iller WHERE kullanici_id = ?')
        .all(kullaniciId)
        .map(r => r.il_id);
}

// GET /api/iller
// Admin -> tum iller; Kullanici -> sadece atanan iller
// ?hepsi=1 -> admin icin harita amacli tum illeri her zaman dondurur
router.get('/', tokenDogrula, (req, res) => {
    if ((req.kullanici.rol === 'admin' || req.kullanici.rol === 'yardimci')) {
        const iller = db.prepare('SELECT * FROM iller ORDER BY plaka').all();
        return res.json(iller);
    }
    const izinli = kullanicininIlleri(req.kullanici.id);
    if (izinli.length === 0) return res.json([]);
    const placeholders = izinli.map(() => '?').join(',');
    const iller = db.prepare(`SELECT * FROM iller WHERE id IN (${placeholders}) ORDER BY plaka`).all(...izinli);
    res.json(iller);
});

// GET /api/iller/harita
// Haritada renklendirme icin: TUM iller + her ile kullanicinin erisip erisemedigi bilgisi
router.get('/harita', tokenDogrula, (req, res) => {
    const tumIller = db.prepare('SELECT id, il_adi, plaka, baskan_ad_soyad, baskan_telefon, baskan_foto FROM iller ORDER BY plaka').all();
    let izinliSet = null;
    if (req.kullanici.rol === 'kullanici') {
        izinliSet = new Set(kullanicininIlleri(req.kullanici.id));
    }
    const ilceSay = {};
    db.prepare('SELECT il_id, COUNT(*) s FROM ilceler GROUP BY il_id').all().forEach(r => ilceSay[r.il_id] = r.s);
    const sonuc = tumIller.map(il => ({
        ...il,
        ilce_sayisi: ilceSay[il.id] || 0,
        erisim: (req.kullanici.rol === 'admin' || req.kullanici.rol === 'yardimci') ? true : izinliSet.has(il.id)
    }));
    res.json(sonuc);
});

// GET /api/iller/istatistik -> ozet sayilar
router.get('/istatistik', tokenDogrula, (req, res) => {
    // Kullanici ise sadece kendi atanan illeri sayalim
    if (req.kullanici.rol === 'kullanici') {
        const izinli = kullanicininIlleri(req.kullanici.id);
        if (!izinli.length) {
            return res.json({ toplamIl: 0, toplamIlce: 0, baskanliIl: 0, baskanliIlce: 0 });
        }
        const phs = izinli.map(()=>'?').join(',');
        const toplamIl = izinli.length;
        const toplamIlce = db.prepare(`SELECT COUNT(*) s FROM ilceler WHERE il_id IN (${phs})`).get(...izinli).s;
        const baskanliIl = db.prepare(`SELECT COUNT(*) s FROM iller WHERE id IN (${phs}) AND baskan_ad_soyad IS NOT NULL AND baskan_ad_soyad != ''`).get(...izinli).s;
        const baskanliIlce = db.prepare(`SELECT COUNT(*) s FROM ilceler WHERE il_id IN (${phs}) AND baskan_ad_soyad IS NOT NULL AND baskan_ad_soyad != ''`).get(...izinli).s;
        return res.json({ toplamIl, toplamIlce, baskanliIl, baskanliIlce });
    }
    // Admin / yardimci - tum sistem
    const toplamIl = db.prepare('SELECT COUNT(*) s FROM iller').get().s;
    const toplamIlce = db.prepare('SELECT COUNT(*) s FROM ilceler').get().s;
    const baskanliIl = db.prepare("SELECT COUNT(*) s FROM iller WHERE baskan_ad_soyad IS NOT NULL AND baskan_ad_soyad != ''").get().s;
    const baskanliIlce = db.prepare("SELECT COUNT(*) s FROM ilceler WHERE baskan_ad_soyad IS NOT NULL AND baskan_ad_soyad != ''").get().s;
    res.json({ toplamIl, toplamIlce, baskanliIl, baskanliIlce });
});

// GET /api/iller/:id  -> tek il detayi (yetki kontrollu)
router.get('/:id', tokenDogrula, (req, res) => {
    const id = parseInt(req.params.id);
    if (req.kullanici.rol === 'kullanici' && !kullanicininIlleri(req.kullanici.id).includes(id)) {
        return res.status(403).json({ hata: 'Bu ile erişim yetkiniz yok.' });
    }
    const il = db.prepare('SELECT * FROM iller WHERE id = ?').get(id);
    if (!il) return res.status(404).json({ hata: 'İl bulunamadı.' });
    res.json(il);
});

// POST /api/iller -> yeni il ekle (sadece admin)
// Not: 81 il seed ile zaten eklenir; bu daha cok manuel ekleme/yedek icin.
router.post('/', tokenDogrula, adminVeyaYardimci, (req, res) => {
    const { il_adi, plaka } = req.body;
    if (!il_adi) return res.status(400).json({ hata: 'İl adı gereklidir.' });
    try {
        const sonuc = db.prepare('INSERT INTO iller (il_adi, plaka) VALUES (?, ?)')
            .run(il_adi, plaka || null);
        res.status(201).json({ mesaj: 'İl eklendi.', id: sonuc.lastInsertRowid });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ hata: 'Bu il zaten ekli.' });
        }
        res.status(500).json({ hata: 'Sunucu hatası.', detay: err.message });
    }
});

// PUT /api/iller/:id -> il guncelle (admin veya o ile atanmis kullanici)
router.put('/:id', tokenDogrula, (req, res) => {
    const id = parseInt(req.params.id);
    if (req.kullanici.rol === 'kullanici' && !kullanicininIlleri(req.kullanici.id).includes(id)) {
        return res.status(403).json({ hata: 'Bu ile erişim yetkiniz yok.' });
    }
    const {
        baskan_ad_soyad, baskan_telefon, baskan_tc, baskan_foto,
        instagram_url, twitter_url, facebook_url, tiktok_url
    } = req.body;

    // Formatla
    const f = kayitFormatla({ baskan_ad_soyad, baskan_telefon, instagram_url, twitter_url, facebook_url, tiktok_url });

    try {
        const sonuc = db.prepare(`
            UPDATE iller SET
                baskan_ad_soyad = COALESCE(?, baskan_ad_soyad),
                baskan_telefon  = COALESCE(?, baskan_telefon),
                baskan_tc       = COALESCE(?, baskan_tc),
                baskan_foto     = COALESCE(?, baskan_foto),
                instagram_url   = COALESCE(?, instagram_url),
                twitter_url     = COALESCE(?, twitter_url),
                facebook_url    = COALESCE(?, facebook_url),
                tiktok_url      = COALESCE(?, tiktok_url)
            WHERE id = ?
        `).run(
            f.baskan_ad_soyad ?? null, f.baskan_telefon ?? null, baskan_tc ?? null, baskan_foto ?? null,
            f.instagram_url ?? null, f.twitter_url ?? null, f.facebook_url ?? null, f.tiktok_url ?? null,
            id
        );
        if (sonuc.changes === 0) return res.status(404).json({ hata: 'İl bulunamadı.' });
        res.json({ mesaj: 'İl güncellendi.' });
    } catch (err) {
        res.status(500).json({ hata: 'Sunucu hatası.', detay: err.message });
    }
});

// POST /api/iller/toplu -> birden cok ilin baskan bilgilerini toplu kaydet
// Body: { satirlar: [{ id, baskan_ad_soyad, baskan_telefon, ... }, ...] }
router.post('/toplu', tokenDogrula, (req, res) => {
    const { satirlar } = req.body;
    if (!Array.isArray(satirlar)) return res.status(400).json({ hata: 'satirlar gereklidir.' });
    const izinli = (req.kullanici.rol === 'admin' || req.kullanici.rol === 'yardimci') ? null : new Set(kullanicininIlleri(req.kullanici.id));
    const guncelle = db.prepare(`UPDATE iller SET
        baskan_ad_soyad = ?, baskan_telefon = ?, baskan_tc = ?, baskan_foto = ?,
        instagram_url = ?, twitter_url = ?, facebook_url = ?, tiktok_url = ?
        WHERE id = ?`);
    let guncellenen = 0;
    for (const s of satirlar) {
        if (!s.id) continue;
        const ilId = parseInt(s.id);
        if (izinli && !izinli.has(ilId)) continue;
        const f = kayitFormatla(s);
        const sonuc = guncelle.run(
            f.baskan_ad_soyad || null, f.baskan_telefon || null, s.baskan_tc || null, s.baskan_foto || null,
            f.instagram_url || null, f.twitter_url || null, f.facebook_url || null, f.tiktok_url || null,
            ilId
        );
        if (sonuc.changes > 0) guncellenen++;
    }
    res.json({ mesaj: 'Toplu güncelleme tamamlandı.', guncellenen });
});

module.exports = router;
