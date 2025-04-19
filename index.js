const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const mongoose = require("mongoose");
const moment = require("moment-jalaali");
const winston = require("winston");

moment.loadPersian({ usePersianDigits: false });

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static("public")); // برای پنل مدیریت HTML

// ---------------- MongoDB Setup ----------------
mongoose.connect("mongodb://mongo:NbqPswHGUNbGRZXVOUwhwAiCZxSESXTW@hopper.proxy.rlwy.net:57835", {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB connection error:", err));

const licenseSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    type: { type: String, enum: ['limited', 'unlimited'], required: true },
    enabled: { type: Boolean, default: true },
    dailyLimit: { type: Number, default: 50 },
    usage: {
        date: String, // تاریخ شمسی
        count: { type: Number, default: 0 }
    }
});

const License = mongoose.model("License", licenseSchema);

// ---------------- Logger ----------------
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'app.log' })
    ]
});

// ---------------- Helpers ----------------
const getTodayDate = () => moment().format("jYYYY-jMM-jDD");

const generateRandomUserId = () => crypto.randomBytes(8).toString("hex");

const url = "https://api.binjie.fun/api/generateStream";
const headers = {
    "authority": "api.binjie.fun",
    "accept": "application/json, text/plain, */*",
    "accept-encoding": "gzip, deflate, br",
    "accept-language": "en-US,en;q=0.9",
    "origin": "https://chat18.aichatos.xyz",
    "referer": "https://chat18.aichatos.xyz/",
    "user-agent": "Mozilla/5.0",
    "Content-Type": "application/json"
};

async function fetchData(query, userId, network = true, withoutContext = false, stream = false) {
    try {
        const data = { prompt: query, userId, network, system: "", withoutContext, stream };
        const response = await axios.post(url, data, { headers, timeout: 10000 });
        return response.data.result || response.data;
    } catch (error) {
        return { error: "Failed to fetch response from AI API", details: error.response?.data || error.message };
    }
}

// ---------------- Request Limit Check ----------------
async function handleMongoRequestLimit(license) {
    const today = getTodayDate();

    if (!license.usage || license.usage.date !== today) {
        license.usage = { date: today, count: 1 };
    } else {
        if (license.usage.count >= license.dailyLimit) return false;
        license.usage.count += 1;
    }

    await license.save();
    return true;
}

// ---------------- Middleware ----------------
app.use(async (req, res, next) => {
    const licenseKey = req.query.license || req.body.license;
    if (!licenseKey) return res.status(403).json({ error: "Missing license key" });

    const license = await License.findOne({ key: licenseKey });
    if (!license) return res.status(403).json({ error: "Invalid license key" });
    if (!license.enabled) return res.status(403).json({ error: "License disabled" });

    if (license.type === "limited") {
        const allowed = await handleMongoRequestLimit(license);
        if (!allowed) return res.status(429).json({ error: "Daily request limit exceeded" });
    }

    req.licenseType = license.type;
    next();
});

// ---------------- AI API Routes ----------------
app.get("/ehsan/g", async (req, res) => {
    const { q, userId, network, withoutContext, stream } = req.query;
    const data = await fetchData(q || "Hello", userId || generateRandomUserId(), network === "true", withoutContext === "true", stream === "true");
    res.json({ developer: "Ehsan Fazli", developerId: "@abj0o", response: data });
});

app.post("/ehsan/g", async (req, res) => {
    const { q, userId, network, withoutContext, stream } = req.body;
    if (!q) return res.status(400).json({ error: "Missing prompt" });
    const data = await fetchData(q, userId || generateRandomUserId(), network, withoutContext, stream);
    res.json({ developer: "Ehsan Fazli", developerId: "@abj0o", response: data });
});

// ---------------- License Management API ----------------
app.get("/api/licenses", async (req, res) => {
    const licenses = await License.find({});
    const result = {};
    licenses.forEach(l => {
        result[l.key] = {
            type: l.type,
            enabled: l.enabled,
            dailyLimit: l.dailyLimit,
            usage: l.usage
        };
    });
    res.json(result);
});

app.post("/api/license", async (req, res) => {
    const { key, type, enabled = true, dailyLimit = 50 } = req.body;
    if (!key || !["limited", "unlimited"].includes(type)) {
        return res.status(400).json({ error: "Invalid key or type" });
    }

    await License.findOneAndUpdate(
        { key },
        { type, enabled, dailyLimit },
        { upsert: true, new: true }
    );

    res.json({ success: true, message: "License saved" });
});

app.delete("/api/license/:key", async (req, res) => {
    const result = await License.deleteOne({ key: req.params.key });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
});

// ---------------- Panel Route (HTML) ----------------
app.get("/panel", (req, res) => {
    res.sendFile(__dirname + "/public/panel.html");
});

// ---------------- Start Server ----------------
app.listen(port, () => logger.info(`Server running at http://localhost:${port}`));
