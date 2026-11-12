import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  getFirestore,
  Timestamp,
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

import { firebaseConfig } from "./config.js";

// --- CONFIGURATION VALIDATION CHECK ---
if (!firebaseConfig || !firebaseConfig.apiKey) {
  console.error("❌ Firebase configuration is missing! Please check your config.js file.");
} else {
  console.log("✅ Firebase configuration loaded successfully for project:", firebaseConfig.projectId);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginSection = document.getElementById("login-section");
const dashboardSection = document.getElementById("dashboard-section");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const statusText = document.getElementById("status");
const logoutButton = document.getElementById("logout-button");
const lastUpdateText = document.getElementById("last-update");
const latestInfoText = document.getElementById("latest-info");
const metricVolume = document.getElementById("metric-volume");
const metricTemperature = document.getElementById("metric-temperature");
const metricHumidity = document.getElementById("metric-humidity");
const metricHeatingStatus = document.getElementById("metric-heating-status");

// Chart configurations
const chartConfigs = [
  { key: "volume", i18n: "remainingVolume", unit: "m³", color: "#d97706", elementId: "volume-chart" },
  { key: "distance", i18n: "remainingHeight", unit: "cm", color: "#16a34a", elementId: "distance-chart" },
  { key: "temperature", i18n: "temperature", unit: "°C", color: "#e87516", elementId: "temperature-chart" },
  { key: "humidity", i18n: "humidity", unit: "%", color: "#2377ba", elementId: "humidity-chart" },
];

// Room calculation constants
const ROOM_LENGTH = 4.13; // meters
const ROOM_WIDTH = 2.15;  // meters
const TOTAL_HEIGHT_CM = 215; // cm
const SENSOR_OFFSET_CM = 2; // cm to remove
const FLOOR_AREA = ROOM_LENGTH * ROOM_WIDTH; // 8.8795 m²
const chartInstances = new Map();

// DOM-Referenzen für Heizung
const heatingStatusSection = document.getElementById("heating-status-section");
const heatingTimestampText = document.getElementById("heating-timestamp");
const valIstAn = document.getElementById("val-ist-an");
const valAsche = document.getElementById("val-asche");
const valMenge = document.getElementById("val-menge");
const heatingErrorsList = document.getElementById("heating-errors-list");
const languageButtons = document.querySelectorAll("[data-language]");

const translations = {
  de: {
    heatingTitle: "Deine Heizung", loginHint: "Melde dich mit deinem Firebase User-Account an.",
    email: "E-Mail", password: "Passwort", login: "Anmelden", pelletStock: "Pelletvorrat",
    currentStock: "Aktueller Bestand", temperature: "Temperatur", humidity: "Luftfeuchtigkeit",
    roomStable: "Innenraum · stabil", roomOptimal: "Innenraum · optimal", heatingStatus: "Heizungsstatus",
    etaPelletUnit: "ETA PelletUnit", systemStatus: "Anlagenstatus", active: "● Aktiv",
    operatingState: "Betriebszustand", pelletAmount: "Pelletmenge", ash: "Asche",
    systemMessages: "Systemmeldungen", noErrors: "Keine aktiven Fehler gemeldet.",
    history: "Verlauf", last30Days: "Messwerte der letzten 30 Tage", logout: "Logout",
    remainingVolume: "Restvolumen", remainingHeight: "Resthöhe", activeState: "🟢 An", inactiveState: "🔴 Aus",
    noMeasurements: "Keine Messwerte in den letzten 30 Tagen gefunden.",
    noValidMeasurements: "Keine gültigen Messwerte gefunden.", loaded: "Messwerte geladen.",
    lastMeasurement: "Letzte Messung", currentVolume: "Aktuelles Restvolumen",
    lastUpdate: "Letztes Update der Anlage", estimated: "ca. {value} kg (geschätzt)",
    loadError: "Fehler beim Laden der Daten aus Firestore.", loginError: "Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen."
  },
  en: {
    heatingTitle: "Your heating system", loginHint: "Sign in with your Firebase user account.",
    email: "Email", password: "Password", login: "Sign in", pelletStock: "Pellet stock",
    currentStock: "Current stock", temperature: "Temperature", humidity: "Humidity",
    roomStable: "Indoor · stable", roomOptimal: "Indoor · optimal", heatingStatus: "Heating status",
    etaPelletUnit: "ETA PelletUnit", systemStatus: "System status", active: "● Active",
    operatingState: "Operating state", pelletAmount: "Pellet amount", ash: "Ash",
    systemMessages: "System messages", noErrors: "No active errors reported.",
    history: "History", last30Days: "Measurements from the last 30 days", logout: "Sign out",
    remainingVolume: "Remaining volume", remainingHeight: "Remaining height", activeState: "🟢 On", inactiveState: "🔴 Off",
    noMeasurements: "No measurements found in the last 30 days.",
    noValidMeasurements: "No valid measurements found.", loaded: "measurements loaded.",
    lastMeasurement: "Last measurement", currentVolume: "Current remaining volume",
    lastUpdate: "Last system update", estimated: "approx. {value} kg (estimated)",
    loadError: "Error loading data from Firestore.", loginError: "Sign-in failed. Please check your email and password."
  }
};

let currentLanguage = localStorage.getItem("language") === "en" ? "en" : "de";
let latestMeasurements = [];
let latestHeatingDoc = null;
let estimatedAshValue = null;
const t = (key) => translations[currentLanguage][key] || key;
const formatTimestamp = (value) => {
  const timestampMillis = normalizeTimestampToMillis(value);
  return Number.isFinite(timestampMillis) ? new Date(timestampMillis).toLocaleString(currentLanguage === "en" ? "en-GB" : "de-DE") : "-";
};

function applyLanguage() {
  document.documentElement.lang = currentLanguage;
  document.title = currentLanguage === "en" ? "Pellet Heating Dashboard" : "Pellet Heizung Dashboard";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  languageButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.language === currentLanguage));
  if (latestMeasurements.length) {
    renderCharts(latestMeasurements);
    updateMeasurementText(latestMeasurements[latestMeasurements.length - 1], latestMeasurements.length);
  }
  if (latestHeatingDoc) {
    updateHeatingLanguage();
  }
}

languageButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentLanguage = button.dataset.language;
    localStorage.setItem("language", currentLanguage);
    applyLanguage();
  });
});

// Hilfsfunktion: Parst einen ETA-XML-String und gibt den 'strValue' oder Text aus
function parseEtaXml(xmlString) {
  if (!xmlString) return "-";
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    
    const valueEl = xmlDoc.querySelector("value");
    if (valueEl) {
      const strVal = valueEl.getAttribute("strValue");
      const unit = valueEl.getAttribute("unit") || "";
      const innerText = valueEl.textContent || "";
      
      if (strVal) {
        return unit ? `${strVal} ${unit}` : strVal;
      }
      return innerText;
    }
    
    const fubEls = xmlDoc.querySelectorAll("fub");
    if (fubEls.length > 0) {
      const names = Array.from(fubEls).map(el => el.getAttribute("name")).filter(Boolean);
      return `Systeme: ${names.join(", ")}`;
    }
  } catch (e) {
    console.error("Fehler beim Parsen des XML:", e);
  }
  return "-";
}

// Hilfsfunktion: Sucht nach Attributen mit msg="..." im XML (für Fehler)
function parseEtaErrors(xmlString) {
  if (!xmlString) return [];
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const errors = [];

    const elementsWithMsg = xmlDoc.querySelectorAll("[msg]");
    elementsWithMsg.forEach(el => {
      const msgText = el.getAttribute("msg");
      if (msgText && msgText.trim() !== "") {
        errors.push(msgText);
      }
    });

    return errors;
  } catch (e) {
    console.error("Fehler beim Parsen der XML-Fehler:", e);
    return [];
  }
}

function setLoginVisible(isVisible) {
  loginSection.classList.toggle("hidden", !isVisible);
}

function setDashboardVisible(isVisible) {
  dashboardSection.classList.toggle("hidden", !isVisible);
  logoutButton.classList.toggle("hidden", !isVisible);
}

function normalizeTimestampToMillis(value) {
  if (value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }
  return NaN;
}

function timestampToLabel(value) {
  return formatTimestamp(value);
}

function updateMeasurementText(latestMeasurement, measurementCount) {
  lastUpdateText.textContent = `${t("lastMeasurement")}: ${timestampToLabel(latestMeasurement.timestamp)}`;
  latestInfoText.textContent = `${t("currentVolume")}: ${latestMeasurement.volume} m³ | ${t("temperature")}: ${latestMeasurement.temperature} °C | ${t("humidity")}: ${latestMeasurement.humidity} %`;
  statusText.textContent = `${measurementCount} ${t("loaded")}`;
}

function updateHeatingLanguage() {
  heatingTimestampText.textContent = `${t("lastUpdate")}: ${timestampToLabel(latestHeatingDoc.timestamp)}`;
  const isAn = latestHeatingDoc.ist_an === true;
  metricHeatingStatus.textContent = isAn ? t("active").replace("● ", "") : t("inactiveState").replace("🔴 ", "");
  valIstAn.textContent = isAn ? t("activeState") : t("inactiveState");
  if (estimatedAshValue) {
    valAsche.textContent = t("estimated").replace("{value}", estimatedAshValue);
  }
  if (heatingErrorsList.children.length === 1 &&
      (heatingErrorsList.textContent === translations.de.noErrors || heatingErrorsList.textContent === translations.en.noErrors)) {
    heatingErrorsList.firstElementChild.textContent = t("noErrors");
  }
}

function destroyCharts() {
  for (const chart of chartInstances.values()) {
    chart.destroy();
  }
  chartInstances.clear();
}

function renderCharts(measurements) {
  destroyCharts();

  const labels = measurements.map((item) => timestampToLabel(item.timestamp));
  const chartTextColor = "#718078";
  const chartGridColor = "rgba(32, 65, 48, 0.08)";

  for (const config of chartConfigs) {
    const canvas = document.getElementById(config.elementId);
    const values = measurements.map((item) => item[config.key]);
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, canvas.clientHeight || 220);
    gradient.addColorStop(0, `${config.color}35`);
    gradient.addColorStop(1, `${config.color}00`);

    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: t(config.i18n),
            data: values,
            borderColor: config.color,
            backgroundColor: gradient,
            borderWidth: 3,
            tension: 0.38,
            cubicInterpolationMode: "monotone",
            fill: "origin",
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBorderWidth: 3,
            pointHoverBackgroundColor: "#fff",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: {
              color: chartTextColor,
              usePointStyle: true,
              pointStyle: "line",
              boxWidth: 28,
              padding: 18,
              font: { size: 11, weight: "600" },
            },
          },
          tooltip: {
            displayColors: false,
            padding: 12,
            backgroundColor: "#172a21",
            titleColor: "#d3ed71",
            bodyColor: "#fff",
            cornerRadius: 10,
            callbacks: {
              label: (context) => `${context.parsed.y.toLocaleString(currentLanguage === "en" ? "en-GB" : "de-DE", { maximumFractionDigits: 2 })} ${config.unit}`,
            },
          },
        },
        scales: {
          x: {
            border: { display: false },
            ticks: {
              color: chartTextColor,
              maxRotation: 0,
              minRotation: 0,
              maxTicksLimit: 6,
              padding: 8,
              font: { size: 10 },
              callback: (_, index) => {
                const timestamp = normalizeTimestampToMillis(measurements[index].timestamp);
                return Number.isFinite(timestamp)
                  ? new Date(timestamp).toLocaleDateString(currentLanguage === "en" ? "en-GB" : "de-DE", { day: "2-digit", month: "2-digit" })
                  : "";
              },
            },
            grid: { display: false }
          },
          y: {
            border: { display: false },
            beginAtZero: false,
            ticks: { color: chartTextColor, padding: 8, font: { size: 10 }, maxTicksLimit: 5 },
            grid: { color: chartGridColor, drawTicks: false }
          }
        },
      },
    });

    chartInstances.set(config.key, chart);
  }
}

async function loadLast30Days() {
  const now = Date.now();
  const thirtyDaysAgoMillis = now - 30 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgoTimestamp = Timestamp.fromMillis(thirtyDaysAgoMillis);

  const timestampMeasurementsQuery = query(
    collection(db, "measurements"),
    where("timestamp", ">=", thirtyDaysAgoTimestamp)
  );
  const numericMeasurementsQuery = query(
    collection(db, "measurements"),
    where("timestamp", ">=", Math.floor(thirtyDaysAgoMillis / 1000))
  );

  let snapshot = await getDocs(timestampMeasurementsQuery);
  if (snapshot.empty) {
    snapshot = await getDocs(numericMeasurementsQuery);
  }

  if (snapshot.empty) {
    statusText.textContent = t("noMeasurements");
    lastUpdateText.textContent = "";
    latestInfoText.textContent = "";
    destroyCharts();
    return;
  }

  const allMeasurements = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      const rawDistance = Number(data.distance);
      
      const effectiveDistance = rawDistance + SENSOR_OFFSET_CM;
      const pelletHeightCm = Math.max(0, Math.min(TOTAL_HEIGHT_CM, TOTAL_HEIGHT_CM - effectiveDistance));
      const volumeM3 = Number((FLOOR_AREA * (pelletHeightCm / 100)).toFixed(2));

      return {
        timestamp: data.timestamp,
        temperature: Number(data.temperature),
        humidity: Number(data.humidity),
        distance: pelletHeightCm,
        volume: volumeM3,
      };
    })
    .filter(
      (item) =>
        Number.isFinite(normalizeTimestampToMillis(item.timestamp)) &&
        Number.isFinite(item.temperature) &&
        Number.isFinite(item.humidity) &&
        Number.isFinite(item.distance) &&
        Number.isFinite(item.volume)
    );

  if (!allMeasurements.length) {
    statusText.textContent = t("noValidMeasurements");
    lastUpdateText.textContent = "";
    latestInfoText.textContent = "";
    destroyCharts();
    return;
  }

  allMeasurements.sort((a, b) => normalizeTimestampToMillis(b.timestamp) - normalizeTimestampToMillis(a.timestamp));

  const latestMeasurement = allMeasurements[0];
  latestMeasurements = allMeasurements.slice(0, 30).reverse();
  metricVolume.textContent = latestMeasurement.volume.toFixed(2);
  metricTemperature.textContent = latestMeasurement.temperature.toFixed(1);
  metricHumidity.textContent = latestMeasurement.humidity.toFixed(1);
  updateMeasurementText(latestMeasurement, latestMeasurements.length);
  renderCharts(latestMeasurements);
}

// Funktion zum Laden des aktuellen Heizungsstatus aus der "heizung"-Collection
async function loadHeatingStatus() {
  try {
    const q = query(collection(db, "heizung"), orderBy("timestamp", "desc"));
    const snapshot = await getDocs(q);

    if (!snapshot.empty && heatingStatusSection) {
      latestHeatingDoc = snapshot.docs[0].data();
      
      heatingStatusSection.classList.remove("hidden");
      
      if (heatingTimestampText) {
        heatingTimestampText.textContent = `${t("lastUpdate")}: ${timestampToLabel(latestHeatingDoc.timestamp)}`;
      }
      
      // ist_an Status
      const isAn = latestHeatingDoc.ist_an;
      if (metricHeatingStatus) {
        metricHeatingStatus.textContent = isAn === true ? t("active").replace("● ", "") : t("inactiveState").replace("🔴 ", "");
        metricHeatingStatus.style.color = isAn === true ? "#16834e" : "#b42318";
      }
      if (valIstAn) {
        valIstAn.textContent = isAn === true ? t("activeState") : t("inactiveState");
        valIstAn.style.color = isAn === true ? "green" : "red";
      }
      
      // Gesamtmenge auslesen (z.B. "5 kg")
      const mengeText = parseEtaXml(latestHeatingDoc.xml_menge);
      if (valMenge) valMenge.textContent = mengeText;

      // Asche berechnen basierend auf der Menge (ca. 0.5% bis 0.7% Ascheanteil bei Pellets)
      if (valAsche) {
        const rawMengeNum = parseFloat(mengeText); // Extrahiert die Zahl aus "5 kg" -> 5
        if (!isNaN(rawMengeNum) && rawMengeNum > 0) {
          const estimatedAshKg = (rawMengeNum * 0.006).toFixed(2); // ca. 0.6% Aschefaktor
          estimatedAshValue = estimatedAshKg;
          valAsche.textContent = t("estimated").replace("{value}", estimatedAshKg);
        } else {
          // Fallback falls parsen fehlschlägt: normaler XML-Parser
          valAsche.textContent = parseEtaXml(latestHeatingDoc.xml_asche);
        }
      }

      // Fehler auslesen (msg="...")
      if (heatingErrorsList) {
        let allErrors = [];
        ["xml_asche", "xml_menge"].forEach(field => {
          if (latestHeatingDoc[field]) {
            const foundErrors = parseEtaErrors(latestHeatingDoc[field]);
            allErrors = allErrors.concat(foundErrors);
          }
        });

        allErrors = [...new Set(allErrors)];
        heatingErrorsList.innerHTML = "";
        if (allErrors.length > 0) {
          allErrors.forEach(err => {
            const li = document.createElement("li");
            li.textContent = err;
            heatingErrorsList.appendChild(li);
          });
        } else {
          const li = document.createElement("li");
          li.textContent = t("noErrors");
          li.style.color = "white";
          heatingErrorsList.appendChild(li);
        }
      }
      
    } else if (heatingStatusSection) {
      heatingStatusSection.classList.add("hidden");
    }
  } catch (error) {
    console.error("Fehler beim Laden des Heizungsstatus:", error);
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    loginError.textContent = t("loginError");
    console.error(error);
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setLoginVisible(true);
    setDashboardVisible(false);
    destroyCharts();
    statusText.textContent = "";
    lastUpdateText.textContent = "";
    latestInfoText.textContent = "";
    latestMeasurements = [];
    latestHeatingDoc = null;
    estimatedAshValue = null;
    if (heatingStatusSection) heatingStatusSection.classList.add("hidden");
    return;
  }

  setLoginVisible(false);
  setDashboardVisible(true);
  statusText.textContent = currentLanguage === "en" ? "Loading data…" : "Lade Daten…";

  try {
    await Promise.all([
      loadLast30Days(),
      loadHeatingStatus()
    ]);
  } catch (error) {
    statusText.textContent = t("loadError");
    console.error(error);
  }
});

applyLanguage();