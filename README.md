# ⛅ Hava Defteri / Weather Logbook

> **Canlı METAR & Resmi TAF Tahmin Doğrulama Dashboard'u**  
> *Live METAR & Official TAF Forecast Verification Dashboard*

---

## 🇹🇷 TÜRKÇE KULLANIM KILAVUZU

### 📌 Proje Hakkında
**Hava Defteri**, meteorolojik tahminlerinizin doğruluğunu resmi havacılık meteorolojisi verileriyle (**NOAA & VATSIM**) gerçek zamanlı olarak test eden ve başarı puanı (0-100) hesaplayan modern bir hava durumu tahmin ve doğrulama arayüzüdür.

#### Temel Özellikler:
* **4 Temel Tahmin Parametresi:** Maksimum Sıcaklık ($T_{max}$), Minimum Sıcaklık ($T_{min}$), Toplam Yağış ($mm$) ve Rüzgâr Hızı ($kts$).
* **Çift Doğrulama Modu (TAF & METAR):**
  * **🎯 Resmi TAF:** Havalimanı meteoroloji ofisinin 24-30 saatlik resmi tahmin modeliyle ($TX/TN$) kıyaslar.
  * **⏱️ Canlı METAR:** Havalimanındaki anlık termometre ve rüzgar gözlemiyle kıyaslar.
  * **⚖️ İkisi Birlikte:** Tahmininizi, TAF'ı ve METAR'ı tek ekranda 3 sütun halinde yan yana gösterir.
* **Hata Skoru & Karne:** Sapmalara ($\Delta$) göre 100 üzerinden anında başarı puanı ve geri bildirim.
* **Dışa Aktarma (Rapor):** Tüm tahmin geçmişinizi Excel ve Python uyumlu UTF-8 CSV olarak indirme.
* **Sıfır Bağımlılık (Zero-Dependency):** `npm install` gerektirmez, 500 MB kütüphane indirmez, doğrudan çalışır.

---

### 🚀 Nasıl Çalıştırılır? (Windows, macOS & Linux)

Sistem tüm işletim sistemlerinde aynı basit adımlarla çalışır:

#### 1. Adım: Node.js Kontrolü / Kurulumu
Bilgisayarınızda Node.js yüklü değilse [nodejs.org](https://nodejs.org) adresinden **LTS** sürümünü indirip kurun.

#### 2. Adım: Sunucuyu Başlatın
Terminal veya Komut Satırını (CMD / PowerShell / Mac Terminal) açın, proje klasörüne gidin ve şu komutu çalıştırın:
```bash
node server.js
```
Konsolda şu çıktıyı göreceksiniz:
```text
====================================================
METAR Forecast & Error Dashboard Sunucusu Aktif!
Adres: http://localhost:3000
API Metar: http://localhost:3000/api/metar?station=LTFM
====================================================
```

#### 3. Adım: Tarayıcıda Açın
Tarayıcınızı (Chrome, Safari, Edge, Firefox, Brave) açın ve şu adrese gidin:
👉 **http://localhost:3000**

---

### 📂 Dosya Yapısı
Proje yalın ve temiz iki ana dosyadan oluşur:
* `dashboard.html`: Modern, gölgesiz ve mat tasarımlı frontend arayüzü ve yerel veri deposu (`localStorage`).
* `server.js`: NOAA ve VATSIM üzerinden canlı METAR ve resmi TAF verilerini çeken bağımsız backend sunucusu.

---
---

## 🇬🇧 ENGLISH USER GUIDE

### 📌 About The Project
**Weather Logbook** is a modern meteorology dashboard designed to test the accuracy of your weather forecasts against official aviation meteorological data (**NOAA & VATSIM**) in real time, calculating an objective performance score (0-100).

#### Key Features:
* **4 Core Forecast Parameters:** Maximum Temperature ($T_{max}$), Minimum Temperature ($T_{min}$), Total Precipitation ($mm$), and Wind Speed ($kts$).
* **Dual Benchmark Modes (TAF & METAR):**
  * **🎯 Official TAF:** Compares your forecast against the aerodrome's official 24-30 hour forecast model ($TX/TN$).
  * **⏱️ Live METAR:** Compares against the current live physical airfield observation.
  * **⚖️ Both Combined:** Displays your forecast, official TAF, and live METAR side-by-side in 3 responsive columns with delta tags.
* **Accuracy Scoring & Feedback:** Computes an immediate 0-100 grade based on meteorological deltas ($\Delta$).
* **Data Export:** Download your forecast trajectory and verification results as a UTF-8 semicolon-separated CSV.
* **Zero-Dependency:** Uses 100% native Node.js core modules. No `npm install` or external packages required.

---

### 🚀 How to Run (Windows, macOS & Linux)

The application runs identically on all major operating systems:

#### Step 1: Install Node.js
If Node.js is not already installed on your machine, download the **LTS** installer from [nodejs.org](https://nodejs.org).

#### Step 2: Start the Server
Open your Terminal or Command Prompt (Terminal on macOS, CMD / PowerShell on Windows), navigate to the project directory, and run:
```bash
node server.js
```
You should see:
```text
====================================================
METAR Forecast & Error Dashboard Sunucusu Aktif!
Adres: http://localhost:3000
API Metar: http://localhost:3000/api/metar?station=LTFM
====================================================
```

#### Step 3: Open in Browser
Open your favorite browser (Chrome, Safari, Edge, Firefox, Brave) and navigate to:
👉 **http://localhost:3000**

---

### 📂 File Structure
The project is built with clean architecture using two primary files:
* `dashboard.html`: Lightweight, tactile, shadow-free frontend application with client-side persistence (`localStorage`).
* `server.js`: Zero-dependency Node.js HTTP proxy fetching live METAR and TAF reports from NOAA Aviation Weather and VATSIM.
