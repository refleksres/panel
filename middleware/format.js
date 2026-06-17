// Veri formatlama yardimcilari

// Ad-Soyad formatla: TDK'ya gore
// "ahmet yılmaz" -> "Ahmet YILMAZ"
// "AHMET ALİ YILMAZ" -> "Ahmet Ali YILMAZ"
// "ahmet" -> "Ahmet" (tek kelime, soyad yok)
function adSoyadFormatla(metin) {
    if (!metin || typeof metin !== 'string') return metin;
    const temiz = metin.trim().replace(/\s+/g, ' ');
    if (!temiz) return '';

    const kelimeler = temiz.split(' ');
    if (kelimeler.length === 1) {
        // Sadece ad -> ilk harf buyuk, kalan kucuk
        return basHarfBuyuk(kelimeler[0]);
    }

    // Son kelime = soyad, hepsi buyuk
    const soyad = kelimeler[kelimeler.length - 1].toLocaleUpperCase('tr-TR');
    // Once gelenler = ad/orta ad, title case
    const adlar = kelimeler.slice(0, -1).map(basHarfBuyuk);
    return [...adlar, soyad].join(' ');
}

function basHarfBuyuk(kelime) {
    if (!kelime) return '';
    const ilk = kelime.charAt(0).toLocaleUpperCase('tr-TR');
    const kalan = kelime.slice(1).toLocaleLowerCase('tr-TR');
    return ilk + kalan;
}

// Telefon formatla
// "5551234567" -> "0555-123-45-67"
// "05551234567" -> "0555-123-45-67"
// "905551234567" -> "+90 555-123-45-67"
// "+905551234567" -> "+90 555-123-45-67"
// "(555) 123 4567" -> "0555-123-45-67"
function telefonFormatla(metin) {
    if (!metin) return metin;
    const m = String(metin).trim();
    if (!m) return '';

    // Sadece rakamlari al
    let rakam = m.replace(/\D/g, '');

    // Uluslararasi format kontrol
    let onek = '0';
    if (rakam.startsWith('90') && rakam.length === 12) {
        onek = '+90 ';
        rakam = rakam.slice(2);
    } else if (rakam.startsWith('0') && rakam.length === 11) {
        rakam = rakam.slice(1);
    } else if (rakam.length === 10) {
        // 0 olmadan girilmis
    } else {
        // Format taninamadi, oldugu gibi don
        return m;
    }

    if (rakam.length !== 10) return m;

    // 5XX-XXX-XX-XX
    const p1 = rakam.slice(0, 3);
    const p2 = rakam.slice(3, 6);
    const p3 = rakam.slice(6, 8);
    const p4 = rakam.slice(8, 10);
    return onek + p1 + '-' + p2 + '-' + p3 + '-' + p4;
}

// URL formatla - kullanici adi verilmisse basina ekler
// "ahmetyilmaz" -> "https://instagram.com/ahmetyilmaz"
// "@ahmetyilmaz" -> "https://instagram.com/ahmetyilmaz"
// "instagram.com/ahmetyilmaz" -> "https://instagram.com/ahmetyilmaz"
// "https://instagram.com/ahmetyilmaz" -> aynisi
function urlFormatla(deger, platform) {
    if (!deger) return deger;
    let m = String(deger).trim();
    if (!m) return '';

    // Tanimli platform domainleri
    const domains = {
        instagram: 'instagram.com',
        twitter: 'twitter.com',
        facebook: 'facebook.com',
        tiktok: 'tiktok.com'
    };
    const domain = domains[platform];
    if (!domain) return m;

    // Bastaki @ kaldir
    if (m.startsWith('@')) m = m.slice(1);

    // Zaten tam URL ise dokunma (http veya https)
    if (m.match(/^https?:\/\//i)) return m;

    // www. ile basliyorsa https ekle
    if (m.match(/^www\./i)) return 'https://' + m;

    // Domain icereniyor mu? (instagram.com/xxx gibi)
    if (m.toLowerCase().includes(domain)) {
        return 'https://' + m.replace(/^\/+/, '');
    }

    // Sadece kullanici adi - bastaki / temizle
    m = m.replace(/^\/+/, '').replace(/\s+/g, '');
    if (!m) return '';

    // TikTok icin @ on eki gerekli (tiktok.com/@kullanici)
    if (platform === 'tiktok' && !m.startsWith('@')) {
        m = '@' + m;
    }

    return 'https://' + domain + '/' + m;
}

// Toplu formatla - bir kayit objesinin tum alanlarini formatla
function kayitFormatla(kayit) {
    if (!kayit || typeof kayit !== 'object') return kayit;
    const k = { ...kayit };

    if (k.baskan_ad_soyad) k.baskan_ad_soyad = adSoyadFormatla(k.baskan_ad_soyad);
    if (k.baskan_telefon) k.baskan_telefon = telefonFormatla(k.baskan_telefon);
    if (k.instagram_url) k.instagram_url = urlFormatla(k.instagram_url, 'instagram');
    if (k.twitter_url) k.twitter_url = urlFormatla(k.twitter_url, 'twitter');
    if (k.facebook_url) k.facebook_url = urlFormatla(k.facebook_url, 'facebook');
    if (k.tiktok_url) k.tiktok_url = urlFormatla(k.tiktok_url, 'tiktok');

    return k;
}

module.exports = {
    adSoyadFormatla,
    telefonFormatla,
    urlFormatla,
    kayitFormatla
};
