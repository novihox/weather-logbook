// Berennaz Balım Dilber <3
// Node.js Canli METAR & Hava Durumu Backend Sunucusu (Zero-dependency)
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const FORECASTS_FILE = path.join(DATA_DIR, 'forecasts.json');
let inMemoryForecasts = [];

// Yardimci HTTPS get fonksiyonu
function httpsGet(requestUrl, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(requestUrl);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'AviationWeatherDashboard/2.0 (Mozilla/5.0)',
                'Accept': '*/*',
                ...headers
            },
            timeout: 8000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP Status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('İstek zaman aşımına uğradı'));
        });
        req.end();
    });
}

// METAR Parser (Raw METAR -> Sayısal Veriler)
function parseMetarString(raw, station = "LTFM") {
    const data = {
        station: station.toUpperCase(),
        raw: raw.trim(),
        obsTime: "",
        timeUTC: "",
        temp: null,
        dewp: null,
        windDir: null,
        windSpeed: null,
        windGust: null,
        visKm: 10,
        qnh: 1013,
        clouds: [],
        flightCategory: "VFR",
        weatherCondition: "Açık / Parçalı"
    };

    if (!raw) return data;

    // Gözlem saati (örn: 252050Z -> Gün 25, Saat 20:50 UTC)
    const timeMatch = raw.match(/(\d{2})(\d{2})(\d{2})Z/);
    if (timeMatch) {
        data.timeUTC = `${timeMatch[2]}:${timeMatch[3]} UTC`;
        data.obsDay = parseInt(timeMatch[1], 10);
    }

    // Rüzgar: 08009KT, 08009G18KT veya VRB03KT
    const windMatch = raw.match(/(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT/);
    if (windMatch) {
        data.windDir = windMatch[1] === "VRB" ? "VRB" : parseInt(windMatch[1], 10);
        data.windSpeed = parseInt(windMatch[2], 10);
        if (windMatch[3]) data.windGust = parseInt(windMatch[3], 10);
    }

    // Görüş: 9999 (10km+), 5000 (5km), 0400 (400m)
    const visMatch = raw.match(/\s(\d{4})\s/);
    if (visMatch) {
        const vMeters = parseInt(visMatch[1], 10);
        data.visKm = vMeters >= 9999 ? 10 : parseFloat((vMeters / 1000).toFixed(1));
    } else if (raw.includes("CAVOK")) {
        data.visKm = 10;
        data.weatherCondition = "CAVOK (Görüş ve Tavan İdeal)";
    }

    // Sıcaklık ve Çiy Noktası: 20/13 veya M02/M05
    const tempMatch = raw.match(/(M?\d{2})\/(M?\d{2})/);
    if (tempMatch) {
        const parseT = (s) => s.startsWith('M') ? -parseInt(s.slice(1), 10) : parseInt(s, 10);
        data.temp = parseT(tempMatch[1]);
        data.dewp = parseT(tempMatch[2]);
    }

    // Altimetre / Basınç: Q1019 veya A2992
    const qnhMatch = raw.match(/Q(\d{4})/);
    if (qnhMatch) {
        data.qnh = parseInt(qnhMatch[1], 10);
    } else {
        const inHgMatch = raw.match(/A(\d{4})/);
        if (inHgMatch) {
            data.qnh = Math.round(parseFloat(inHgMatch[1]) / 100 * 33.8639);
        }
    }

    // Hava Olayları
    if (raw.includes("TSRA") || raw.includes("+TSRA")) data.weatherCondition = "Orajlı Şiddetli Yağmur";
    else if (raw.includes("TS")) data.weatherCondition = "Fırtına / Oraj";
    else if (raw.includes("SHRA") || raw.includes("RA")) data.weatherCondition = "Yağmur";
    else if (raw.includes("-RA")) data.weatherCondition = "Hafif Yağmur";
    else if (raw.includes("SN")) data.weatherCondition = "Kar Yağışı";
    else if (raw.includes("FG")) data.weatherCondition = "Yoğun Sis";
    else if (raw.includes("BR") || raw.includes("HZ")) data.weatherCondition = "Pus / Duman";

    // Uçuş Kategorisi
    if (raw.includes("OVC002") || raw.includes("BKN004") || (data.visKm !== null && data.visKm < 1.6)) {
        data.flightCategory = "LIFR";
    } else if (raw.includes("BKN008") || (data.visKm !== null && data.visKm < 5)) {
        data.flightCategory = "IFR";
    } else if (raw.includes("BKN015") || (data.visKm !== null && data.visKm < 8)) {
        data.flightCategory = "MVFR";
    } else {
        data.flightCategory = "VFR";
    }

    return data;
}

// Canlı METAR Çekme Fonksiyonu (Yedekli: NOAA JSON -> VATSIM RAW -> Sentetik)
async function fetchLiveMetar(station = "LTFM") {
    station = station.toUpperCase();
    let parsed = null;

    // 1. Kaynak: NOAA Aviation Weather Center JSON API
    try {
        const noaaJsonStr = await httpsGet(`https://aviationweather.gov/api/data/metar?ids=${station}&format=json`);
        const list = JSON.parse(noaaJsonStr);
        if (Array.isArray(list) && list.length > 0) {
            const item = list[0];
            parsed = parseMetarString(item.rawOb || "", station);
            if (item.temp !== undefined && item.temp !== null) parsed.temp = item.temp;
            if (item.dewp !== undefined && item.dewp !== null) parsed.dewp = item.dewp;
            if (item.wspd !== undefined && item.wspd !== null) parsed.windSpeed = item.wspd;
            if (item.wdir !== undefined && item.wdir !== null) parsed.windDir = item.wdir;
            if (item.altim !== undefined && item.altim !== null) parsed.qnh = item.altim;
            if (item.fltCat) parsed.flightCategory = item.fltCat;
            parsed.source = "NOAA Aviation Weather Center";
        }
    } catch (err) {
        console.warn(`[METAR] NOAA API uyarisi (${station}):`, err.message);
    }

    // 2. Kaynak: VATSIM Real-time METAR
    if (!parsed) {
        try {
            const vatsimRaw = await httpsGet(`https://metar.vatsim.net/${station}`);
            if (vatsimRaw && vatsimRaw.trim().length > 5) {
                parsed = parseMetarString(vatsimRaw.trim(), station);
                parsed.source = "VATSIM Global Network";
            }
        } catch (err) {
            console.warn(`[METAR] VATSIM API uyarisi (${station}):`, err.message);
        }
    }

    // 3. Fallback (Sentetik Güvenli Veri)
    if (!parsed) {
        const fallbackRaw = `METAR ${station} 011520Z 04022KT 9999 SCT030 19/11 Q1022 NOSIG`;
        parsed = parseMetarString(fallbackRaw, station);
        parsed.source = "Yerel Simülasyon (Fallback)";
    }

    // 4. Günün Gerçek Yağış ve Ekstremumlarını Open-Meteo İstasyon Koordinatlarından Çek
    try {
        const coords = AIRPORT_COORDS[station] || AIRPORT_COORDS["LTFM"];
        const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&wind_speed_unit=kn&timezone=auto`;
        const omRaw = await httpsGet(omUrl);
        const omData = JSON.parse(omRaw);
        if (omData && omData.daily) {
            parsed.realPrecip = Number((omData.daily.precipitation_sum?.[0] ?? 0.0).toFixed(1));
            parsed.realTmax = Number((omData.daily.temperature_2m_max?.[0] ?? (parsed.temp + 2.5)).toFixed(1));
            parsed.realTmin = Number((omData.daily.temperature_2m_min?.[0] ?? (parsed.temp - 5.0)).toFixed(1));
            if (omData.daily.wind_speed_10m_max?.[0]) parsed.realWindMax = Math.round(omData.daily.wind_speed_10m_max[0]);
        }
    } catch (e) {
        parsed.realPrecip = 0.0;
        parsed.realTmax = parsed.temp !== null ? Number((parsed.temp + 2.5).toFixed(1)) : 22.0;
        parsed.realTmin = parsed.temp !== null ? Number((parsed.temp - 5.0).toFixed(1)) : 14.0;
    }

    return parsed;
}

// TAF Parser (Raw TAF -> 4 Parametreli Öngörüler)
function parseTafString(raw, station = "LTFM") {
    station = station.toUpperCase();
    const data = {
        station: station,
        raw: (raw || "").trim(),
        validPeriod: "",
        tmax: null,
        tmin: null,
        windSpeed: 10,
        windDir: 60,
        precip: 0.0,
        source: "NOAA Aviation Weather Center (Official TAF)"
    };

    if (!raw) return data;

    // Geçerlilik Periyodu (örn: 0112/0218)
    const validMatch = raw.match(/\s(\d{4}\/\d{4})\s/);
    if (validMatch) data.validPeriod = validMatch[1];

    // Tmax (TX) örn: TX23/2612Z veya TX23
    const txMatch = raw.match(/TX(M?\d{2})/);
    if (txMatch) {
        const val = txMatch[1];
        data.tmax = val.startsWith('M') ? -parseInt(val.slice(1), 10) : parseInt(val, 10);
    }

    // Tmin (TN) örn: TN14/2604Z veya TN14
    const tnMatch = raw.match(/TN(M?\d{2})/);
    if (tnMatch) {
        const val = tnMatch[1];
        data.tmin = val.startsWith('M') ? -parseInt(val.slice(1), 10) : parseInt(val, 10);
    }

    // Rüzgar (örn: 05022G34KT)
    const windMatch = raw.match(/(?:VRB|\d{3})(\d{2,3})(?:G\d{2,3})?KT/);
    if (windMatch) {
        data.windSpeed = parseInt(windMatch[1], 10);
    }

    // Yağış: TAF içinde RA, SHRA, TSRA, DZ geçiyor mu?
    if (raw.includes("TSRA") || raw.includes("+RA") || raw.includes("+SHRA")) {
        data.precip = 6.0;
    } else if (raw.includes("SHRA") || raw.includes("RA") || raw.includes("SN")) {
        data.precip = 2.5;
    } else if (raw.includes("-SHRA") || raw.includes("-RA") || raw.includes("DZ") || raw.includes("-DZ")) {
        data.precip = 1.0;
    } else {
        data.precip = 0.0;
    }

    return data;
}

// Canlı TAF Çekme Fonksiyonu
async function fetchLiveTaf(station = "LTFM") {
    station = station.toUpperCase();
    let parsed = null;

    try {
        const noaaTafRaw = await httpsGet(`https://aviationweather.gov/api/data/taf?ids=${station}&format=raw`);
        if (noaaTafRaw && noaaTafRaw.trim().length > 10) {
            parsed = parseTafString(noaaTafRaw.trim(), station);
        }
    } catch (err) {
        console.warn(`[TAF] NOAA TAF uyarisi (${station}):`, err.message);
    }

    if (!parsed) {
        const fallbackRaw = `TAF ${station} 011040Z 0112/0218 05022G34KT 9999 SCT030 TEMPO 0112/0115 -SHRA BECMG 0115/0118 05018KT`;
        parsed = parseTafString(fallbackRaw, station);
        parsed.source = "Standart Havalimanı TAF Modeli (Simülasyon)";
    }

    // Türkiye ve Avrupa sivil TAF'larında TX/TN sıcaklık grupları yer almaz.
    // Resmi ECMWF / GFS süperbilgisayar tahminlerini TAF öngörüsü ile birleştiriyoruz:
    try {
        const coords = AIRPORT_COORDS[station] || AIRPORT_COORDS["LTFM"];
        const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&models=ecmwf_ifs025&wind_speed_unit=kn&timezone=auto`;
        const omRaw = await httpsGet(omUrl);
        const omData = JSON.parse(omRaw);
        if (omData && omData.daily) {
            if (parsed.tmax === null && omData.daily.temperature_2m_max_ecmwf_ifs025?.[1] !== undefined) {
                parsed.tmax = Number(omData.daily.temperature_2m_max_ecmwf_ifs025[1].toFixed(1));
            }
            if (parsed.tmin === null && omData.daily.temperature_2m_min_ecmwf_ifs025?.[1] !== undefined) {
                parsed.tmin = Number(omData.daily.temperature_2m_min_ecmwf_ifs025[1].toFixed(1));
            }
            if (omData.daily.precipitation_sum_ecmwf_ifs025?.[1] !== undefined) {
                const omP = Number(omData.daily.precipitation_sum_ecmwf_ifs025[1].toFixed(1));
                if (parsed.precip === 0.0 && omP > 0) parsed.precip = omP;
            }
        }
    } catch (e) { }

    if (parsed.tmax === null) parsed.tmax = 22;
    if (parsed.tmin === null) parsed.tmin = 14;

    return parsed;
}

// Havalimanı Koordinatları (Open-Meteo GFS & ECMWF Modelleri İçin)
const AIRPORT_COORDS = {
    "LTFM": { lat: 41.275, lon: 28.751, name: "İstanbul Havalimanı" },
    "LTFJ": { lat: 40.898, lon: 29.309, name: "Sabiha Gökçen Havalimanı" },
    "LTBA": { lat: 40.976, lon: 28.814, name: "Atatürk Havalimanı" },
    "LTAC": { lat: 40.128, lon: 32.995, name: "Ankara Esenboğa" },
    "LTAI": { lat: 36.898, lon: 30.800, name: "Antalya Havalimanı" },
    "LTBJ": { lat: 38.292, lon: 27.156, name: "İzmir Adnan Menderes" },
    "LTBS": { lat: 36.713, lon: 28.792, name: "Muğla Dalaman" }
};

async function fetchRealModels(station = "LTFM") {
    const coords = AIRPORT_COORDS[station.toUpperCase()] || AIRPORT_COORDS["LTFM"];
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&models=gfs_seamless,ecmwf_ifs025&wind_speed_unit=kn&timezone=auto`;
    const rawJson = await httpsGet(apiUrl);
    return JSON.parse(rawJson);
}

// Hata Payı Hesaplayıcı (Forecast vs METAR)
function calculateError(forecast, actualMetar) {
    // 4 Parametreli Tahmin Kontrolü (Tmax, Tmin, Yağış, Rüzgar)
    if (forecast.tmax !== undefined && forecast.tmin !== undefined) {
        const baseT = actualMetar.temp !== null ? actualMetar.temp : 20;
        const actTmax = (actualMetar.realTmax !== undefined) ? actualMetar.realTmax : Number((baseT + 2.5).toFixed(1));
        const actTmin = (actualMetar.realTmin !== undefined) ? actualMetar.realTmin : Number((baseT - 5.0).toFixed(1));
        const actPrecip = (actualMetar.realPrecip !== undefined) ? actualMetar.realPrecip : (actualMetar.precip !== undefined ? actualMetar.precip : 0.0);
        const actWind = actualMetar.windSpeed !== null ? actualMetar.windSpeed : 10;

        const fTmax = Number(forecast.tmax);
        const fTmin = Number(forecast.tmin);
        const fPrecip = Number(forecast.precip || 0);
        const fWind = Number(forecast.wind || 0);

        const diffTmax = Number((fTmax - actTmax).toFixed(1));
        const absTmax = Math.abs(diffTmax);

        const diffTmin = Number((fTmin - actTmin).toFixed(1));
        const absTmin = Math.abs(diffTmin);

        const diffPrecip = Number((fPrecip - actPrecip).toFixed(1));
        const absPrecip = Math.abs(diffPrecip);

        const diffWind = Number((fWind - actWind).toFixed(1));
        const absWind = Math.abs(diffWind);

        const penalty = (absTmax * 3.0) + (absTmin * 3.0) + (absPrecip * 2.0) + (absWind * 1.5);
        const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

        let grade = "Mükemmel";
        let gradeColor = "#10b981";
        if (score < 50) { grade = "Yüksek Sapma"; gradeColor = "#ef4444"; }
        else if (score < 75) { grade = "Kabul Edilebilir"; gradeColor = "#f59e0b"; }
        else if (score < 90) { grade = "Çok Başarılı"; gradeColor = "#38bdf8"; }

        const breakdown = [
            { parameter: "Maksimum Sıcaklık (Tmax)", unit: "°C", forecast: fTmax, actual: actTmax, diff: diffTmax, absErr: absTmax },
            { parameter: "Minimum Sıcaklık (Tmin)", unit: "°C", forecast: fTmin, actual: actTmin, diff: diffTmin, absErr: absTmin },
            { parameter: "Toplam Yağış", unit: "mm", forecast: fPrecip, actual: actPrecip, diff: diffPrecip, absErr: absPrecip },
            { parameter: "Rüzgâr Hızı", unit: "kts", forecast: fWind, actual: actWind, diff: diffWind, absErr: absWind }
        ];

        const worstDev = [...breakdown].sort((a, b) => b.absErr - a.absErr)[0];
        const feedback = penalty <= 3 ? "🎯 Harika Tahmin! Tmax, Tmin, Yağış ve Rüzgâr parametrelerinin tümünde yüksek isabet sağladınız." :
            `⚠️ En belirgin sapma **${worstDev.parameter}** parametresinde gerçekleşti (${worstDev.absErr} ${worstDev.unit} fark).`;

        return { score, grade, gradeColor, penalty: Number(penalty.toFixed(1)), breakdown, worstDeviation: worstDev, feedbackNote: feedback, actualMetar };
    }

    // Standart METAR Parametreleri Hesabı (Fallback)
    const fTemp = Number(forecast.temp);
    const actTemp = Number(actualMetar.temp);
    const tempDiff = Number((fTemp - actTemp).toFixed(1));
    const absTempErr = Math.abs(tempDiff);

    // 2. Çiy Noktası Hatası (°C)
    let dewDiff = null;
    let absDewErr = null;
    if (forecast.dewp !== undefined && forecast.dewp !== null && forecast.dewp !== "" && actualMetar.dewp !== null) {
        dewDiff = Number((Number(forecast.dewp) - Number(actualMetar.dewp)).toFixed(1));
        absDewErr = Math.abs(dewDiff);
    }

    // 3. Rüzgar Hızı Hatası (knot)
    const fWind = Number(forecast.windSpeed);
    const actWind = Number(actualMetar.windSpeed);
    const windDiff = Number((fWind - actWind).toFixed(1));
    const absWindErr = Math.abs(windDiff);

    // 4. Rüzgar Yönü Hatası (derece, dairesel en kısa açı)
    let windDirDiff = null;
    if (forecast.windDir !== undefined && forecast.windDir !== null && forecast.windDir !== "" && actualMetar.windDir !== null && actualMetar.windDir !== "VRB") {
        const d1 = Number(forecast.windDir);
        const d2 = Number(actualMetar.windDir);
        const rawDiff = Math.abs(d1 - d2);
        windDirDiff = Math.min(rawDiff, 360 - rawDiff);
    }

    // 5. Basınç / QNH Hatası (hPa)
    let qnhDiff = null;
    let absQnhErr = null;
    if (forecast.qnh && actualMetar.qnh) {
        qnhDiff = Number((Number(forecast.qnh) - Number(actualMetar.qnh)).toFixed(1));
        absQnhErr = Math.abs(qnhDiff);
    }

    // 6. Görüş Hatası (km)
    let visDiff = null;
    let absVisErr = null;
    if (forecast.visKm !== undefined && forecast.visKm !== null && actualMetar.visKm !== null) {
        visDiff = Number((Number(forecast.visKm) - Number(actualMetar.visKm)).toFixed(1));
        absVisErr = Math.abs(visDiff);
    }

    // 7. Ceza Puanı ve Başarı Skoru (100 üzerinden)
    // Sıcaklık 1°C = 3 ceza puanı
    // Rüzgar Hızı 1kt = 1.5 ceza puanı
    // Rüzgar Yönü her 10° = 1 ceza puanı
    // Basınç 1 hPa = 1.5 ceza puanı
    // Çiy Noktası 1°C = 1 ceza puanı
    let penalty = (absTempErr * 3.0) + (absWindErr * 1.5);
    if (absDewErr !== null) penalty += (absDewErr * 1.0);
    if (windDirDiff !== null) penalty += ((windDirDiff / 10.0) * 1.0);
    if (absQnhErr !== null) penalty += (absQnhErr * 1.5);
    if (absVisErr !== null) penalty += (absVisErr * 0.8);

    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

    // Derecelendirme
    let grade = "Mükemmel Doğruluk";
    let gradeColor = "#10b981";
    if (score < 50) {
        grade = "Yüksek Sapma (Geliştirilmeli)";
        gradeColor = "#ef4444";
    } else if (score < 75) {
        grade = "Kabul Edilebilir";
        gradeColor = "#f59e0b";
    } else if (score < 90) {
        grade = "Çok Başarılı";
        gradeColor = "#38bdf8";
    }

    // Parametre sapmaları listesi
    const errorBreakdown = [
        { parameter: "Sıcaklık", unit: "°C", forecast: fTemp, actual: actTemp, diff: tempDiff, absErr: absTempErr, weight: "Yüksek" },
        { parameter: "Rüzgâr Hızı", unit: "kts", forecast: fWind, actual: actWind, diff: windDiff, absErr: absWindErr, weight: "Yüksek" }
    ];

    if (dewDiff !== null) {
        errorBreakdown.push({ parameter: "Çiy Noktası", unit: "°C", forecast: Number(forecast.dewp), actual: Number(actualMetar.dewp), diff: dewDiff, absErr: absDewErr, weight: "Orta" });
    }
    if (windDirDiff !== null) {
        errorBreakdown.push({ parameter: "Rüzgâr Yönü", unit: "°", forecast: Number(forecast.windDir), actual: Number(actualMetar.windDir), diff: windDirDiff, absErr: windDirDiff, weight: "Orta" });
    }
    if (qnhDiff !== null) {
        errorBreakdown.push({ parameter: "Basınç (QNH)", unit: "hPa", forecast: Number(forecast.qnh), actual: Number(actualMetar.qnh), diff: qnhDiff, absErr: absQnhErr, weight: "Yüksek" });
    }
    if (visDiff !== null) {
        errorBreakdown.push({ parameter: "Görüş Mesafesi", unit: "km", forecast: Number(forecast.visKm), actual: Number(actualMetar.visKm), diff: visDiff, absErr: absVisErr, weight: "Düşük" });
    }

    // En yüksek sapmayı bul
    const worstDev = [...errorBreakdown].sort((a, b) => b.absErr - a.absErr)[0];
    let feedback = "";
    if (penalty <= 3) {
        feedback = "🎯 Tebrikler! Tahmininiz güncel METAR gözlemiyle neredeyse birebir eşleşti.";
    } else {
        const direction = worstDev.diff > 0 ? "yüksek" : "düşük";
        feedback = `⚠️ En belirgin sapma **${worstDev.parameter}** parametresinde gerçekleşti (${Math.abs(worstDev.diff)} ${worstDev.unit} ${direction} tahmin edildi).`;
    }

    return {
        score,
        grade,
        gradeColor,
        penalty: Number(penalty.toFixed(1)),
        breakdown: errorBreakdown,
        worstDeviation: worstDev,
        feedbackNote: feedback,
        actualMetar: actualMetar
    };
}
// HTTP Server
const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // 1. GET /api/metar?station=LTFM
    if (pathname === '/api/metar' && req.method === 'GET') {
        const station = (parsedUrl.query.station || "LTFM").toString();
        try {
            const metarData = await fetchLiveMetar(station);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, data: metarData }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    // 1b. GET /api/taf?station=LTFM (Resmi 24-30 saatlik havalimanı tahmini)
    if (pathname === '/api/taf' && req.method === 'GET') {
        const station = (parsedUrl.query.station || "LTFM").toString();
        try {
            const tafData = await fetchLiveTaf(station);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, data: tafData }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    // 1c. GET /api/models?station=LTFM (Gerçek NOAA GFS ve ECMWF modelleri)
    if (pathname === '/api/models' && req.method === 'GET') {
        const station = (parsedUrl.query.station || "LTFM").toString();
        try {
            const modelsData = await fetchRealModels(station);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, data: modelsData, station: station.toUpperCase() }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    // 2. POST /api/compare (Tahmin ile METAR karşılaştır ve hata hesapla)
    if (pathname === '/api/compare' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                const station = payload.station || "LTFM";
                const forecast = payload.forecast;

                if (!forecast) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: "forecast parametresi gereklidir" }));
                    return;
                }

                // Gerçek METAR'ı çek
                const actualMetar = payload.actualMetar || await fetchLiveMetar(station);
                const comparisonResult = calculateError(forecast, actualMetar);

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, result: comparisonResult }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    // 3. POST /api/forecasts (Tahmin kaydet)
    if (pathname === '/api/forecasts' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const record = JSON.parse(body);
                record.id = record.id || Date.now();
                record.createdAt = new Date().toISOString();

                // Hafızaya yaz (klasör varsa dosyaya da yaz)
                inMemoryForecasts.push(record);
                if (fs.existsSync(DATA_DIR)) {
                    try { fs.writeFileSync(FORECASTS_FILE, JSON.stringify(inMemoryForecasts, null, 2), 'utf8'); } catch (e) { }
                }

                res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, record }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    // 4. GET /api/forecasts (Kayıtlı tahminleri listele)
    if (pathname === '/api/forecasts' && req.method === 'GET') {
        try {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, data: inMemoryForecasts }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    // Statik Dosyalar (HTML / CSS / JS Dashboard)
    let filePath = path.join(__dirname, pathname === '/' ? 'dashboard.html' : pathname);
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, 'dashboard.html');
    }
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
    };

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Dosya bulunamadi');
        } else {
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
            res.end(content);
        }
    });
});

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`METAR Forecast & Error Dashboard Sunucusu Aktif!`);
        console.log(`Adres: http://localhost:${PORT}`);
        console.log(`API Metar: http://localhost:${PORT}/api/metar?station=LTFM`);
        console.log(`====================================================`);
    });
}

module.exports = { server, parseMetarString, calculateError, fetchLiveMetar };
