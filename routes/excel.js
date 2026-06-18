const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../database/db');
const { tokenDogrula } = require('../middleware/auth');
const { kayitFormatla } = require('../middleware/format');
const router = express.Router();

// Turkce normalize: kucuk harf + tr karakter sadelestirme
function norm(s) {
    if (s === null || s === undefined) return '';
    return String(s).toLowerCase()
        .replace(/ı/g,'i').replace(/İ/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g')
        .replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c').replace(/Ş/g,'s').replace(/Ğ/g,'g')
        .replace(/Ü/g,'u').replace(/Ö/g,'o').replace(/Ç/g,'c')
        .replace(/[^a-z0-9]/g,'').trim();
}

// AKILLI ALGILAYICI - basliktan sutun tipini bul
function sutunTipiBul(baslik) {
    const n = norm(baslik);
    if (!n) return null;

    // Plaka
    if (n === 'plaka' || n === 'no' || n === 'sira' || n === 'siralama' || n === 'sn' || n === 'id') {
        if (n === 'plaka') return 'plaka';
    }
    if (n.includes('plaka')) return 'plaka';

    // Ilce - "ilce adi" + varyasyonlar (once kontrol et, "il" eslesmesi onlemek icin)
    if (n.includes('ilce') || n.includes('kaza') || n === 'belde' || n === 'belediye') {
        if (n.includes('ad') || n.includes('isim') || n === 'ilce' || n === 'ilcesi' || n === 'kaza' || n === 'belde') {
            return 'ilce_adi';
        }
        return 'ilce_adi'; // herhangi bir ilce icermesi de yeter
    }
    if (n === 'district') return 'ilce_adi';

    // Il
    if (n === 'il' || n === 'ili' || n === 'sehir' || n === 'sehri' || n === 'memleket' || n === 'province' || n === 'city') return 'il_adi';
    if (n.includes('il') && (n.includes('ad') || n.includes('isim')) && !n.includes('ilce')) return 'il_adi';
    if (n.includes('sehir') || n.includes('province') || n.includes('city')) return 'il_adi';

    // Ad Soyad / Baskan
    if (n.includes('adsoyad') || n.includes('soyad') || n.includes('isim') ||
        n.includes('baskan') || n.includes('sorumlu') || n.includes('yetkili') ||
        n.includes('koordinator') || n.includes('temsilci') || n.includes('uye') ||
        n.includes('ad') || n === 'name' || n === 'fullname' || n === 'tam' || n === 'kisi') {
        // "ad" cok genel olabilir, ama bu noktada baska sutun adlari kontrol edildi
        return 'baskan_ad_soyad';
    }

    // Telefon
    if (n.includes('telefon') || n.includes('tel') || n.includes('gsm') || n.includes('cep') ||
        n.includes('numara') || n.includes('phone') || n.includes('mobile') || n === 'no' || n === 'irtibat') return 'baskan_telefon';

    // TC Kimlik
    if (n.includes('tc') || n.includes('kimlik') || n.includes('tckn') || n === 'tcno' || n === 'tckno' ||
        n.includes('vatandaslik') || n.includes('identity')) return 'baskan_tc';

    // Instagram
    if (n.includes('instagram') || n.includes('insta') || n === 'ig' || n === 'igadresi' || n === 'igusername') return 'instagram_url';

    // Twitter/X
    if (n.includes('twitter') || n.includes('tweet') || n === 'x' || n === 'xadresi') return 'twitter_url';

    // Facebook
    if (n.includes('facebook') || n.includes('face') || n === 'fb') return 'facebook_url';

    // TikTok
    if (n.includes('tiktok') || n.includes('tik') || n === 'tt') return 'tiktok_url';

    return null;
}

// AKILLI ALGILAYICI - icerikten sutun tipini bul
function icerikTipiBul(deger) {
    const d = String(deger||'').toLowerCase().trim();
    if (!d) return null;

    // URL kontrolu
    if (d.includes('instagram.com') || d.match(/^@?[a-z0-9._]+\s*\(instagram\)/)) return 'instagram_url';
    if (d.includes('twitter.com') || d.includes('x.com')) return 'twitter_url';
    if (d.includes('facebook.com') || d.includes('fb.com')) return 'facebook_url';
    if (d.includes('tiktok.com')) return 'tiktok_url';

    // TC kimlik (11 hane sayi)
    if (/^\d{11}$/.test(d)) return 'baskan_tc';

    // Telefon (10-11 hane, 5 ile basliyor genelde)
    if (/^[0-9\s\-\(\)+]{10,15}$/.test(d.replace(/[\s\-\(\)+]/g,'')) && d.replace(/\D/g,'').length >= 10 && d.replace(/\D/g,'').length <= 13) {
        if (!/^\d{11}$/.test(d.replace(/\D/g,''))) return 'baskan_telefon';
    }

    return null;
}

// AKILLI ICEEIK ALGILAYICI - cogunluk oyu (sutundaki en sik tip)
function sutunIcerigindenTipBul(satirlar, sutunIndex) {
    const sayim = {};
    let bakilan = 0;
    for (let r = 1; r < Math.min(satirlar.length, 11); r++) {
        const v = String(satirlar[r][sutunIndex] || '').trim();
        if (!v) continue;
        bakilan++;
        const t = icerikTipiBul(v);
        if (t) sayim[t] = (sayim[t] || 0) + 1;
    }
    if (!bakilan) return null;
    let max = 0, sonuc = null;
    for (const [tip, sayi] of Object.entries(sayim)) {
        if (sayi > max && sayi >= Math.ceil(bakilan / 2)) { max = sayi; sonuc = tip; }
    }
    return sonuc;
}

// Il/Ilce isim algilama - icerige bakarak
function ilIsmiOlasiMi(deger, tumIller) {
    const d = norm(deger);
    if (!d || d.length < 3) return false;
    return tumIller.some(il => norm(il.il_adi) === d);
}

// Hucre degerini string'e cevir
function hucreMetni(deger) {
    if (deger === null || deger === undefined) return '';
    if (typeof deger === 'object') {
        if (deger.text) return String(deger.text);
        if (deger.result) return String(deger.result);
        if (deger.richText) return deger.richText.map(t => t.text).join('');
        if (deger.hyperlink) return String(deger.hyperlink);
        return '';
    }
    return String(deger);
}

async function dosyaOku(base64) {
    const veri = base64.includes(',') ? base64.split(',')[1] : base64;
    const buf = Buffer.from(veri, 'base64');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const satirlar = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
        const arr = [];
        const maxCol = ws.actualColumnCount || row.cellCount || 0;
        for (let c = 1; c <= Math.max(maxCol, row.cellCount); c++) {
            arr.push(hucreMetni(row.getCell(c).value));
        }
        satirlar.push(arr);
    });
    return satirlar;
}

// Baslik satirini bul - genelde 1. satir ama bos satir olabilir, basliklarda iceriklerden farkli olabilir
function baslikSatirinibul(satirlar) {
    for (let i = 0; i < Math.min(satirlar.length, 5); i++) {
        const dolu = satirlar[i].filter(h => String(h).trim() !== '').length;
        if (dolu >= 2) return i;
    }
    return 0;
}

// ========== GEMINI AI ILE AKILLI ALGILAMA ==========
// Excel verisini Gemini'ye gonderir, "her satir hangi il/ilce/kisi" kararini ona verir
async function geminiIleAlgila(satirlar, tip) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY .env dosyasında tanımlı değil. Sistem yöneticisine başvurun.');
    }

    // Satirlari CSV gibi metin yap (sadece dolu olanlari, ilk 100 satir)
    const ilkN = satirlar.slice(0, Math.min(satirlar.length, 100));
    const veriMetni = ilkN
        .map((row, idx) => `Satır ${idx + 1}: ` + row.map(c => String(c || '').trim()).filter(c => c).join(' | '))
        .filter(s => s.length > 10)
        .join('\n');

    if (!veriMetni.trim()) {
        throw new Error('Excel dosyası boş veya okunamadı.');
    }

    const istek = tip === 'il'
        ? `Aşağıdaki Excel verisini analiz et. Bu Türkiye il başkanları/sorumluları listesi.
Her bir il için aşağıdaki bilgileri çıkar (sadece bulabildiğin alanları):
- il_adi: il adı (zorunlu)
- baskan_ad_soyad: kişinin adı ve soyadı
- baskan_telefon: telefon numarası
- baskan_tc: 11 haneli TC kimlik no
- instagram_url: instagram hesabı
- twitter_url: twitter/x hesabı
- facebook_url: facebook hesabı
- tiktok_url: tiktok hesabı

ÖNEMLİ KURALLAR:
- Sadece JSON dizisi döndür, başka açıklama YAZMA
- Format: [{"il_adi":"Ordu","baskan_ad_soyad":"Ahmet Yılmaz",...}, ...]
- Bilgi yoksa o alanı koyma (null değil, hiç koyma)
- İl isimleri Türkçe karakterlerle olmalı (Ordu, İstanbul, Şanlıurfa gibi)
- Sosyal medya: sadece kullanıcı adı yazılıysa @işareti veya tam URL olmasa bile aynen yaz

Excel verisi:
${veriMetni}`
        : `Aşağıdaki Excel verisini analiz et. Bu Türkiye ilçe başkanları/sorumluları listesi.
Her bir ilçe için aşağıdaki bilgileri çıkar:
- il_adi: ilçenin bağlı olduğu il adı (zorunlu)
- ilce_adi: ilçe adı (zorunlu)
- baskan_ad_soyad: kişinin adı ve soyadı
- baskan_telefon: telefon numarası
- baskan_tc: 11 haneli TC kimlik no
- instagram_url, twitter_url, facebook_url, tiktok_url: sosyal medya hesapları

ÖNEMLİ KURALLAR:
- Sadece JSON dizisi döndür, başka açıklama YAZMA
- Format: [{"il_adi":"Ordu","ilce_adi":"Altınordu",...}, ...]
- Bilgi yoksa o alanı koyma
- Aynı il altında birden çok ilçe olabilir (excel'de il bir kere yazılıp altına ilçeler dizilmiş olabilir) - her ilçe için il_adi'nı tekrar yaz
- İl ve ilçe isimleri Türkçe karakterlerle (Ordu/Altınordu, İstanbul/Beyoğlu gibi)

Excel verisi:
${veriMetni}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const cevap = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: istek }] }],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json'
            }
        })
    });

    if (!cevap.ok) {
        const txt = await cevap.text();
        throw new Error('Gemini API hatası: ' + cevap.status + ' - ' + txt.substring(0, 200));
    }

    const data = await cevap.json();
    const metin = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!metin) {
        throw new Error('Gemini yanıt vermedi.');
    }

    let json;
    try {
        // JSON markdown bloklari icinde gelmis olabilir, temizle
        const temiz = metin.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
        json = JSON.parse(temiz);
    } catch (e) {
        throw new Error('Gemini geçerli JSON döndürmedi: ' + metin.substring(0, 200));
    }

    if (!Array.isArray(json)) {
        throw new Error('Gemini liste döndürmedi.');
    }

    return json;
}

// POST /api/excel/ai-onizle - Gemini ile algila
router.post('/ai-onizle', tokenDogrula, async (req, res) => {
    const { dosya, tip } = req.body;
    if (!dosya) return res.status(400).json({ hata: 'Dosya gereklidir.' });

    let satirlar;
    try { satirlar = await dosyaOku(dosya); } catch (e) { return res.status(400).json({ hata: 'Excel dosyası okunamadı.' }); }
    if (!satirlar.length) return res.status(400).json({ hata: 'Dosya boş.' });

    try {
        const sonuclar = await geminiIleAlgila(satirlar, tip);
        const sorunlar = [];
        const temiz = [];
        for (const ham of sonuclar) {
            const k = kayitFormatla(ham);
            if (tip === 'il' && !k.il_adi) { sorunlar.push({ satir: temiz.length+1, sorun: 'İl adı boş' }); continue; }
            if (tip === 'ilce' && (!k.il_adi || !k.ilce_adi)) { sorunlar.push({ satir: temiz.length+1, sorun: 'İl veya ilçe adı boş' }); continue; }
            temiz.push(k);
        }
        res.json({ toplam: temiz.length, sonuclar: temiz, sorunlar, ai: true });
    } catch (e) {
        console.error('AI hata:', e.message);
        res.status(500).json({ hata: 'AI ile analiz başarısız: ' + e.message });
    }
});

// ========== AKILLI ALGILAYICI (BEDAVA) ==========

// POST /api/excel/onizle - AKILLI ALGILAMA
router.post('/onizle', tokenDogrula, async (req, res) => {
    const { dosya, tip } = req.body;
    if (!dosya) return res.status(400).json({ hata: 'Dosya gereklidir.' });
    let satirlar;
    try { satirlar = await dosyaOku(dosya); } catch (e) { return res.status(400).json({ hata: 'Excel dosyası okunamadı.' }); }
    if (!satirlar.length) return res.status(400).json({ hata: 'Dosya boş.' });

    const baslikIdx = baslikSatirinibul(satirlar);
    const basliklar = satirlar[baslikIdx];
    const sutunMap = {};
    const taninanSutunlar = [];
    const tumIller = db.prepare('SELECT il_adi FROM iller').all();

    // 1. Baslik isimlerine bakarak algila
    basliklar.forEach((b, i) => {
        const t = sutunTipiBul(b);
        if (t && !Object.values(sutunMap).includes(t)) {
            sutunMap[i] = t;
            taninanSutunlar.push({ index: i, baslik: b, tip: t, kaynak: 'baslik' });
        }
    });

    // 2. Eksik kalanlar icin icerige bakarak algila
    if (satirlar.length > baslikIdx + 1) {
        basliklar.forEach((b, i) => {
            if (sutunMap[i]) return;
            // Once URL/desen algilamasi
            const icerikTipi = sutunIcerigindenTipBul(satirlar.slice(baslikIdx), i);
            if (icerikTipi && !Object.values(sutunMap).includes(icerikTipi)) {
                sutunMap[i] = icerikTipi;
                taninanSutunlar.push({ index: i, baslik: b||'(otomatik)', tip: icerikTipi, kaynak: 'icerik' });
                return;
            }
            // Il ismi olasi mi? (icerige bak)
            if (!Object.values(sutunMap).includes('il_adi')) {
                let ilEslesme = 0, kontrol = 0;
                for (let r = baslikIdx + 1; r < Math.min(satirlar.length, baslikIdx + 11); r++) {
                    const v = String(satirlar[r][i] || '').trim();
                    if (!v) continue;
                    kontrol++;
                    if (ilIsmiOlasiMi(v, tumIller)) ilEslesme++;
                }
                if (kontrol > 0 && ilEslesme >= Math.ceil(kontrol / 2)) {
                    sutunMap[i] = 'il_adi';
                    taninanSutunlar.push({ index: i, baslik: b||'(otomatik)', tip: 'il_adi', kaynak: 'icerik-il' });
                }
            }
        });
    }

    // 3. Ad-Soyad sutunu hala yoksa, isim gibi gorunen bir text sutununu ad olarak isaretle
    if (!Object.values(sutunMap).includes('baskan_ad_soyad')) {
        basliklar.forEach((b, i) => {
            if (sutunMap[i]) return;
            // 3+ harfli, sayi olmayan, en cok 50 karakter olan degerler isim olabilir
            let isimGibi = 0, kontrol = 0;
            for (let r = baslikIdx + 1; r < Math.min(satirlar.length, baslikIdx + 11); r++) {
                const v = String(satirlar[r][i] || '').trim();
                if (!v) continue;
                kontrol++;
                if (/^[A-Za-zçğıöşüÇĞİÖŞÜ\s\.]{3,60}$/.test(v) && v.split(' ').length >= 2) isimGibi++;
            }
            if (kontrol > 0 && isimGibi >= Math.ceil(kontrol * 0.7) && !Object.values(sutunMap).includes('baskan_ad_soyad')) {
                sutunMap[i] = 'baskan_ad_soyad';
                taninanSutunlar.push({ index: i, baslik: b||'(otomatik)', tip: 'baskan_ad_soyad', kaynak: 'icerik-isim' });
            }
        });
    }

    const sonuclar = [];
    const sorunlar = [];
    for (let r = baslikIdx + 1; r < satirlar.length; r++) {
        const satir = satirlar[r];
        if (satir.every(h => String(h).trim() === '')) continue;
        const kayit = {};
        for (const [idx, t] of Object.entries(sutunMap)) {
            const v = String(satir[idx] ?? '').trim();
            if (v) kayit[t] = v;
        }
        if (tip === 'il' && !kayit.il_adi) { sorunlar.push({ satir: r+1, sorun: 'İl adı boş veya algılanamadı' }); continue; }
        if (tip === 'ilce' && (!kayit.il_adi || !kayit.ilce_adi)) { sorunlar.push({ satir: r+1, sorun: 'İl veya ilçe adı boş' }); continue; }
        sonuclar.push(kayitFormatla(kayit));
    }
    res.json({ toplam: sonuclar.length, sonuclar, sorunlar, taninanSutunlar });
});

// POST /api/excel/uygula
router.post('/uygula', tokenDogrula, (req, res) => {
    const { sonuclar, tip } = req.body;
    if (!Array.isArray(sonuclar)) return res.status(400).json({ hata: 'Geçersiz veri.' });

    let izinliIller = null;
    if (req.kullanici.rol === 'kullanici') {
        izinliIller = new Set(db.prepare('SELECT il_id FROM kullanici_iller WHERE kullanici_id = ?').all(req.kullanici.id).map(r => r.il_id));
    }

    let basarili = 0, ilceBasarili = 0, atlanan = 0;
    const ilBul = db.prepare('SELECT id FROM iller WHERE il_adi = ? COLLATE NOCASE');
    const tumIller = db.prepare('SELECT id, il_adi FROM iller').all();
    function ilEslestir(ad) {
        const tam = ilBul.get(ad); if (tam) return tam.id;
        const na = norm(ad);
        const bul = tumIller.find(i => norm(i.il_adi) === na);
        return bul ? bul.id : null;
    }
    // Mevcut ilceyi bul (yeni ekleme yapma)
    function ilceEslestir(ilId, ilceAdi) {
        if (!ilId || !ilceAdi) return null;
        const tam = db.prepare('SELECT id FROM ilceler WHERE il_id=? AND ilce_adi=? COLLATE NOCASE').get(ilId, String(ilceAdi).trim());
        if (tam) return tam.id;
        const na = norm(ilceAdi);
        const tumIlceler = db.prepare('SELECT id, ilce_adi FROM ilceler WHERE il_id=?').all(ilId);
        const bul = tumIlceler.find(i => norm(i.ilce_adi) === na);
        return bul ? bul.id : null;
    }

    for (const ham of sonuclar) {
        const k = kayitFormatla(ham);
        try {
            const ilId = ilEslestir(k.il_adi);
            if (!ilId) { atlanan++; continue; }
            if (izinliIller && !izinliIller.has(ilId)) { atlanan++; continue; }

            // Kayitta ilce_adi varsa: ILCEYI guncelle (il'e dokunma)
            if (k.ilce_adi && String(k.ilce_adi).trim()) {
                const ilceId = ilceEslestir(ilId, k.ilce_adi);
                if (ilceId) {
                    db.prepare(`UPDATE ilceler SET
                        baskan_ad_soyad=COALESCE(?,baskan_ad_soyad), baskan_telefon=COALESCE(?,baskan_telefon),
                        baskan_tc=COALESCE(?,baskan_tc), instagram_url=COALESCE(?,instagram_url),
                        twitter_url=COALESCE(?,twitter_url), facebook_url=COALESCE(?,facebook_url), tiktok_url=COALESCE(?,tiktok_url)
                        WHERE id=?`).run(k.baskan_ad_soyad||null,k.baskan_telefon||null,k.baskan_tc||null,k.instagram_url||null,k.twitter_url||null,k.facebook_url||null,k.tiktok_url||null,ilceId);
                    ilceBasarili++;
                } else {
                    // Mevcut ilce bulunamadi - YENI EKLEMIYORUZ, sadece atla
                    atlanan++;
                }
            } else {
                // Sadece il bilgisi - il'i guncelle
                db.prepare(`UPDATE iller SET
                    baskan_ad_soyad=COALESCE(?,baskan_ad_soyad), baskan_telefon=COALESCE(?,baskan_telefon),
                    baskan_tc=COALESCE(?,baskan_tc), instagram_url=COALESCE(?,instagram_url),
                    twitter_url=COALESCE(?,twitter_url), facebook_url=COALESCE(?,facebook_url), tiktok_url=COALESCE(?,tiktok_url)
                    WHERE id=?`).run(k.baskan_ad_soyad||null,k.baskan_telefon||null,k.baskan_tc||null,k.instagram_url||null,k.twitter_url||null,k.facebook_url||null,k.tiktok_url||null,ilId);
                basarili++;
            }
        } catch (e) { atlanan++; }
    }
    let mesaj = '';
    const parcalar = [];
    if (basarili > 0) parcalar.push(basarili + ' il güncellendi');
    if (ilceBasarili > 0) parcalar.push(ilceBasarili + ' ilçe güncellendi');
    if (atlanan > 0) parcalar.push(atlanan + ' kayıt atlandı (eşleşmeyen il/ilçe)');
    mesaj = parcalar.length ? parcalar.join(', ') + '.' : 'Hiç kayıt güncellenmedi.';
    res.json({ mesaj, basarili: basarili + ilceBasarili, ilceBasarili, atlanan });
});

async function excelGonder(res, satirlar, ad) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Veriler');
    satirlar.forEach(s => ws.addRow(s));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col, i) => {
        let max = 10;
        satirlar.forEach(s => { const v = String(s[i] ?? ''); if (v.length > max) max = Math.min(v.length, 50); });
        col.width = max + 2;
    });
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="' + ad + '.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(Buffer.from(buf));
}

router.get('/sablon', tokenDogrula, async (req, res) => {
    const tip = req.query.tip === 'ilce' ? 'ilce' : 'il';
    let basliklar, satirlar;
    if (tip === 'il') {
        basliklar = ['Plaka','İl Adı','İlçe Adı','Tanıtım ve Medya Başkanı','Telefon','TC Kimlik No','Instagram','Twitter','Facebook','TikTok'];
        satirlar = [
            basliklar,
            ['52', 'Ordu', '', 'Ahmet YILMAZ', '0555-123-45-67', '', 'https://instagram.com/ornek', '', '', ''],
            ['', 'Ordu', 'Altınordu', 'Mehmet DEMİR', '0555-111-22-33', '', '', '', '', ''],
            ['', 'Ordu', 'Ünye', 'Hasan KARA', '0555-444-55-66', '', '', '', '', '']
        ];
    } else {
        basliklar = ['İl Adı','İlçe Adı','Tanıtım ve Medya Başkanı','Telefon','TC Kimlik No','Instagram','Twitter','Facebook','TikTok'];
        satirlar = [
            basliklar,
            ['Ordu', 'Altınordu', 'Mehmet DEMİR', '0555-111-22-33', '', '', '', '', ''],
            ['Ordu', 'Ünye', 'Hasan KARA', '0555-444-55-66', '', '', '', '', '']
        ];
    }
    await excelGonder(res, satirlar, 'sablon-' + tip);
});

router.get('/disa-aktar', tokenDogrula, async (req, res) => {
    const tip = req.query.tip === 'ilce' ? 'ilce' :
                req.query.tip === 'birlesik' ? 'birlesik' : 'il';
    const ilIdsRaw = req.query.il_ids || '';  // ornek: "1,5,12"
    const secimIller = ilIdsRaw.split(',').map(s => parseInt(s)).filter(n => n > 0);

    let izinliIller = null;
    if (req.kullanici.rol === 'kullanici') {
        izinliIller = db.prepare('SELECT il_id FROM kullanici_iller WHERE kullanici_id = ?').all(req.kullanici.id).map(r => r.il_id);
    }

    // Filtre uygulama: secim varsa onu kullan, yoksa izinli, yoksa hepsi
    function ilIdFiltresi() {
        if (secimIller.length) {
            if (izinliIller) {
                // Kullanici hem secim hem izin var - kesisim
                return secimIller.filter(id => izinliIller.includes(id));
            }
            return secimIller;
        }
        return izinliIller; // null veya array
    }

    const filtre = ilIdFiltresi();

    if (tip === 'il') {
        let sorgu = 'SELECT plaka, il_adi, baskan_ad_soyad, baskan_telefon, baskan_tc, instagram_url, twitter_url, facebook_url, tiktok_url FROM iller';
        let params = [];
        let veri;
        if (filtre !== null) {
            if (!filtre.length) veri = [];
            else { sorgu += ' WHERE id IN ('+filtre.map(()=>'?').join(',')+')'; params = filtre; }
        }
        sorgu += ' ORDER BY plaka';
        if (veri === undefined) veri = db.prepare(sorgu).all(...params);
        const basliklar = ['Plaka','İl Adı','Tanıtım ve Medya Başkanı','Telefon','TC Kimlik No','Instagram','Twitter','Facebook','TikTok'];
        const satirlar = [basliklar];
        veri.forEach(r => satirlar.push([r.plaka, r.il_adi, r.baskan_ad_soyad, r.baskan_telefon, r.baskan_tc, r.instagram_url, r.twitter_url, r.facebook_url, r.tiktok_url]));
        return await excelGonder(res, satirlar, 'iller-' + (secimIller.length === 1 ? 'tekil' : 'liste'));
    } else if (tip === 'ilce') {
        let sorgu = `SELECT i.il_adi, c.ilce_adi, c.baskan_ad_soyad, c.baskan_telefon, c.baskan_tc, c.instagram_url, c.twitter_url, c.facebook_url, c.tiktok_url FROM ilceler c JOIN iller i ON c.il_id = i.id`;
        let params = [];
        let veri;
        if (filtre !== null) {
            if (!filtre.length) veri = [];
            else { sorgu += ' WHERE c.il_id IN ('+filtre.map(()=>'?').join(',')+')'; params = filtre; }
        }
        sorgu += ' ORDER BY i.il_adi, c.ilce_adi';
        if (veri === undefined) veri = db.prepare(sorgu).all(...params);
        const basliklar = ['İl Adı','İlçe Adı','Tanıtım ve Medya Başkanı','Telefon','TC Kimlik No','Instagram','Twitter','Facebook','TikTok'];
        const satirlar = [basliklar];
        veri.forEach(r => satirlar.push([r.il_adi, r.ilce_adi, r.baskan_ad_soyad, r.baskan_telefon, r.baskan_tc, r.instagram_url, r.twitter_url, r.facebook_url, r.tiktok_url]));
        return await excelGonder(res, satirlar, 'ilceler-' + (secimIller.length === 1 ? 'tekil' : 'liste'));
    } else {
        // BIRLESIK: hem il hem ilceleri
        let ilSorgu = 'SELECT id, plaka, il_adi, baskan_ad_soyad, baskan_telefon, baskan_tc, instagram_url, twitter_url, facebook_url, tiktok_url FROM iller';
        let ilParams = [];
        let iller;
        if (filtre !== null) {
            if (!filtre.length) iller = [];
            else { ilSorgu += ' WHERE id IN ('+filtre.map(()=>'?').join(',')+')'; ilParams = filtre; }
        }
        ilSorgu += ' ORDER BY plaka';
        if (iller === undefined) iller = db.prepare(ilSorgu).all(...ilParams);

        const basliklar = ['Plaka','İl Adı','İlçe Adı','Tanıtım ve Medya Başkanı','Telefon','TC Kimlik No','Instagram','Twitter','Facebook','TikTok'];
        const satirlar = [basliklar];
        for (const il of iller) {
            // Once il satiri (ilce_adi bos)
            satirlar.push([il.plaka, il.il_adi, '', il.baskan_ad_soyad, il.baskan_telefon, il.baskan_tc, il.instagram_url, il.twitter_url, il.facebook_url, il.tiktok_url]);
            // Sonra o ilin ilceleri
            const ilceler = db.prepare(`SELECT ilce_adi, baskan_ad_soyad, baskan_telefon, baskan_tc, instagram_url, twitter_url, facebook_url, tiktok_url FROM ilceler WHERE il_id = ? ORDER BY ilce_adi`).all(il.id);
            for (const c of ilceler) {
                satirlar.push(['', il.il_adi, c.ilce_adi, c.baskan_ad_soyad, c.baskan_telefon, c.baskan_tc, c.instagram_url, c.twitter_url, c.facebook_url, c.tiktok_url]);
            }
        }
        return await excelGonder(res, satirlar, 'iller-ve-ilceler-' + (secimIller.length === 1 ? 'tekil' : 'liste'));
    }
});

module.exports = router;
