import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Typography, Paper, Divider, Grid } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DirectionsCarIcon from "@mui/icons-material/DirectionsCar";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import SouthIcon from "@mui/icons-material/South";
import deviceImg from "../../assets/device.png";
import HardwarePage from "./console/HardwarePage.tsx";
import Fade from "@mui/material/Fade";
import mqtt from "mqtt";

import Settings from "./Setting";
import View from "./View";

import "./device.css";

const DEFAULT_FROM = "Central";
const DEFAULT_TO = "Airport";
const DEFAULT_DISTANCE = 18;
const DEFAULT_READER = "BUS_12";

const CARD_PRESETS = [
  { label: "Valid Card (GO)", uid: "04A1B2C3D4" },
  { label: "Blocked Card (DENIED)", uid: "04DEADBEEF01" },
  { label: "Low Balance (DENIED)", uid: "0433CCDD9911" },
];

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

// WebAudio tones (no mp3 needed)
function playTone(type = "go") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.connect(g);
    g.connect(ctx.destination);

    const t0 = ctx.currentTime;

    if (type === "go") {
      o.type = "sine";
      o.frequency.setValueAtTime(880, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);

      o.frequency.setValueAtTime(1320, t0 + 0.14);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.16);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    } else {
      o.type = "square";
      o.frequency.setValueAtTime(220, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    }

    o.start();
    o.stop(t0 + 0.35);
    o.onended = () => ctx.close();
  } catch {
    // ignore autoplay blocks
  }
}
///

function ListDevice() {
  ////

  const WS_URL =
    import.meta.env.VITE_MQTT_WS || "wss://cubic.judgeindiasolutions.com:mqtt";
  const REQ_TOPIC = import.meta.env.VITE_REQ_TOPIC || "motu/tap/request";
  const RESP_TOPIC = import.meta.env.VITE_RESP_TOPIC || "motu/tap/response";

  const [connected, setConnected] = useState(false);
  const [uid, setUid] = useState(CARD_PRESETS[0].uid);

  // READY | GO | DENIED
  const [screen, setScreen] = useState("READY");
  const [resp, setResp] = useState(null);

  // ripple trigger
  const [rippleKey, setRippleKey] = useState(0);

  // history
  const [history, setHistory] = useState([]);

  const clientRef = useRef(null);
  const resetTimerRef = useRef(null);

  const clearResetTimer = () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  };

  const armAutoReset = () => {
    clearResetTimer();
    resetTimerRef.current = setTimeout(() => {
      setScreen("READY");
      setResp(null);
    }, 3000);
  };

  useEffect(() => {
    const c = mqtt.connect(WS_URL, {
      reconnectPeriod: 1000,
      connectTimeout: 5000,
      clean: true,
    });

    clientRef.current = c;

    c.on("connect", () => {
      setConnected(true);
      c.subscribe(RESP_TOPIC, { qos: 1 });
    });

    c.on("reconnect", () => setConnected(false));
    c.on("close", () => setConnected(false));
    c.on("offline", () => setConnected(false));
    c.on("error", () => setConnected(false));

    c.on("message", (topic, payload) => {
      if (topic !== RESP_TOPIC) return;
      try {
        const data = JSON.parse(payload.toString());
        setResp(data);

        const nextScreen = data.decision === "GO" ? "GO" : "DENIED";
        setScreen(nextScreen);

        playTone(nextScreen === "GO" ? "go" : "denied");

        setHistory((prev) => {
          const item = {
            ts: data.ts,
            uid: data.uid,
            decision: data.decision,
            trip_state: data.trip_state,
            fare: data.fare,
            remaining_balance: data.remaining_balance,
            reason: data.reason,
            request_id: data.request_id,
          };
          return [item, ...prev].slice(0, 10);
        });

        armAutoReset();
      } catch {
        // ignore
      }
    });

    return () => {
      clearResetTimer();
      c.end(true);
    };
  }, [WS_URL, RESP_TOPIC]);

  const publishTap = () => {
    if (!clientRef.current) return;

    setRippleKey((k) => k + 1);

    const payload = {
      uid,
      from: DEFAULT_FROM,
      to: DEFAULT_TO,
      distance_km: DEFAULT_DISTANCE,
      reader_id: DEFAULT_READER,
      ts: nowTs(),
    };

    clientRef.current.publish(REQ_TOPIC, JSON.stringify(payload), { qos: 1 });
  };

  const fareDetails = useMemo(() => {
    const d = resp || {};
    return {
      from: d.from ?? DEFAULT_FROM,
      to: d.to ?? DEFAULT_TO,
      distance_km: d.distance_km ?? DEFAULT_DISTANCE,
      fare: d.fare ?? 0,
      prev_balance: d.prev_balance ?? 0,
      remaining_balance: d.remaining_balance ?? 0,
      trip_state: d.trip_state ?? "—",
      reason: d.reason ?? "—",
      request_id: d.request_id ?? "—",
      device_ip: d.device_ip ?? "—",
      validator_version: d.validator_version ?? "—",
      latency_ms: d.latency_ms ?? "—",
      message: d.message ?? "",
      decision: d.decision ?? "",
      uid: d.uid ?? uid,
    };
  }, [resp, uid]);

  const displayTitle =
    screen === "GO" ? "GO" : screen === "DENIED" ? "DENIED" : "Tap Below";

  const displaySub =
    screen === "GO"
      ? fareDetails.message || "Amount detected"
      : screen === "DENIED"
        ? fareDetails.message || "Denied"
        : "Tap your card on reader";
  ///
  const [balance, setBalance] = useState(120);
  const [screenState, setScreenState] = useState("IDLE");

  const location = useLocation();
  const navigate = useNavigate();
  const deviceData = location.state?.device;
  const deviceID = location.state?.device?.id;


 


  useEffect(() => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto", // change to "smooth" if you want animation
    });
  }, []);

  return (
    <Box sx={{ flexGrow: 1, p: 2 }}>
      {/* Header Wrapper */}
      <Box sx={{ position: "relative", mb: 3 }}>
        {/* Back Button - Left */}
        <Box
          sx={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 1,
            cursor: "pointer",
            "&:hover": { opacity: 0.7 },
          }}
          onClick={() => navigate("/")}
        >
          <ArrowBackIcon fontSize="small" />
          <Typography fontWeight={600}>Back</Typography>
        </Box>

        {/* Right Links */}
        <Box
          sx={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            display: "none",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Typography
            sx={{ cursor: "pointer", fontWeight: 600 }}
            onClick={() => navigate("/sensor")}
          >
            Sensors
          </Typography>
          |

          <Typography
            sx={{ cursor: "pointer", fontWeight: 600 }}
            onClick={() => navigate("/setting")}
          >
            Settings
          </Typography>
        </Box>

        {/* Title - Center */}
        <Typography variant="h5" fontWeight={700} textAlign="center">
          Device: {deviceData?.name} - {deviceData?.model}
         
        </Typography>
      </Box>

      <Grid container spacing={2}>
        <Grid size={4} >
          <Paper sx={{ p: 2 }} style={{ height: "100%", position: "relative" }}>
            <div style={{display: "none"}}>
            <div className="top-right" style={{ marginTop: "20px" }}>
              <div className={`pill ${connected ? "ok" : "bad"}`}>
                <span className="dot" />
                {connected ? "MQTT Connected" : "MQTT Disconnected"}
              </div>
            </div>

            {/* ===== DEVICE AREA ===== */}
            <Box
              sx={{
                position: "relative",
                width: 450,
                minHeight: "70vh",
                mx: "auto",
                mb: 0,
              }}
            >
              <Box
                component="img"
                src={deviceImg}
                alt="Validator device"
                sx={{ width: "100%" }}
              />

              {/* DISPLAY */}
              <Box
                sx={{
                  position: "absolute",
                  top: 60,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 298,
                  height: 180,
                  borderRadius: 1,
                  background:
                    screen === "GO"
                      ? "#e8f5e9"
                      : screen === "DENIED"
                        ? "#ffebee"
                        : "#f4f8ff",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  px: 2,
                  transition: "0.3s ease",
                }}
              >
                {screen === "READY" && (
                  <Box className="ripple-container">
                    <span className="ripple ripple1" />
                    <span className="ripple ripple2" />
                  </Box>
                )}

                <Typography fontWeight={700}>{displayTitle}</Typography>
                <Typography fontSize={13} mt={0.5}>
                  {displaySub}
                </Typography>

                {screen !== "READY" && (
                  <Box mt={1} fontSize={12} width="100%">
                    <ResultRow label="UID" value={fareDetails.uid} />
                    <ResultRow label="Trip" value={fareDetails.trip_state} />
                    <ResultRow label="Fare" value={`₹${fareDetails.fare}`} />
                    <ResultRow
                      label="Bal"
                      value={`₹${fareDetails.remaining_balance}`}
                    />
                    <ResultRow label="Reason" value={fareDetails.reason} />
                  </Box>
                )}
              </Box>

              {/* DIAMOND BUTTON */}
              <Box
                onClick={publishTap}
                sx={{
                  position: "absolute",
                  top: "60%",
                  left: "50%",
                  transform: "translate(-50%, -50%) rotate(45deg)",
                  width: 120,
                  height: 120,
                  borderRadius: 3,
                  background:
                    "linear-gradient(145deg,#5fa8ff 0%, #1f5fae 100%)",
                  boxShadow: "0 18px 35px rgba(0,0,0,0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  transition: ".25s",
                  "&:hover": {
                    transform:
                      "translate(-50%, -50%) rotate(45deg) scale(1.05)",
                  },
                }}
              >
                <Box sx={{ transform: "rotate(-45deg)" }}>
                  <Typography sx={{ color: "#fff", fontWeight: 600 }}>
                    Tap Here
                  </Typography>
                </Box>
              </Box>
            </Box>

            {/* ===== UID SELECT ===== */}
            <Box mb={4}>
              <Typography fontWeight={600} fontSize={14} color="#1f4f82" mb={1}>
                Card UID
              </Typography>

              <select
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  fontSize: "14px",
                }}
              >
                {CARD_PRESETS.map((c) => (
                  <option key={c.uid} value={c.uid}>
                    {c.label} — {c.uid}
                  </option>
                ))}
              </select>
            </Box>

            </div>
            <img src="/image.jpeg" alt="" style={{maxWidth: "100%", padding: "20px", marginTop: "20px"}} />
          </Paper>
        </Grid>

        <Grid size={8}>
          <Paper sx={{ p: 2, height: "100%" }}>
            <HardwarePage deviceID={deviceID} />
          </Paper>
        </Grid>
        <Grid size={6} style={{display: "none"}}>
          {/* RIGHT fare details */}

          <Paper
            sx={{
              height: "100%",
              p: 5,
              display: "flex",
              flexDirection: "column",
              justifyContent: resp ? "flex-start" : "flex-start",
              alignItems: "center",
            }}
          >
            {/* Always show header */}
            <Typography
              sx={{
                textAlign: "center",
                fontWeight: 700,
                fontSize: 20,
                color: "#1f4f82",
                letterSpacing: 0.5,
              }}
            >
              Fare Details
            </Typography>

            <Divider
              sx={{
                my: 3,
                width: "100%",
                background:
                  "linear-gradient(to right, #dbeafe, #bfdbfe, #dbeafe)",
                height: 2,
                borderRadius: 2,
              }}
            />

            {/* If no response yet → show blank / placeholder */}
            {!resp ? (
              <Typography
                sx={{
                  color: "rgba(31,79,130,0.4)",
                  fontSize: 14,
                }}
              >
                Waiting for tap...
              </Typography>
            ) : (
              <Box
                sx={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <EnhancedRow
                  icon={<ArrowBackIcon sx={{ color: "#1f4f82" }} />}
                  label="Trip"
                  value={fareDetails.trip_state}
                />

                <EnhancedRow
                  icon={<ErrorIcon sx={{ color: "#1f4f82" }} />}
                  label="Reason"
                  value={fareDetails.reason}
                />

                <EnhancedRow
                  icon={<CreditCardIcon sx={{ color: "#1f4f82" }} />}
                  label="Request ID"
                  value={fareDetails.request_id}
                />

                <EnhancedRow
                  icon={<DirectionsCarIcon sx={{ color: "#1f4f82" }} />}
                  label="Device"
                  value={fareDetails.device_ip}
                />

                <EnhancedRow
                  icon={<CheckCircleIcon sx={{ color: "#1f4f82" }} />}
                  label="Version"
                  value={fareDetails.validator_version}
                />

                <EnhancedRow
                  icon={<SouthIcon sx={{ color: "#1f4f82" }} />}
                  label="Latency"
                  value={
                    fareDetails.latency_ms && fareDetails.latency_ms !== "—"
                      ? `${fareDetails.latency_ms} ms`
                      : "—"
                  }
                  bold
                />
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid size={6} style={{display: "none"}}>
          {/* LEFT */}
          <Paper sx={{ p: 2, height: "100%" }}>
            {/* ===== TRIP HISTORY ===== */}
            <Box>
              <Typography fontWeight={700} fontSize={16} color="#1f4f82" mb={2}>
                Trip History
              </Typography>

              <Box
                sx={{
                  maxHeight: 320,
                  minHeight: 320,
                  overflowY: "auto",
                  pr: 1,
                }}
              >
                {history.length === 0 ? (
                  <Typography fontSize={13} color="gray">
                    No taps yet.
                  </Typography>
                ) : (
                  history.map((h, idx) => (
                    <Box
                      key={`${h.request_id}-${idx}`}
                      sx={{
                        mb: 1.5,
                        p: 1.5,
                        borderRadius: 2,
                        background:
                          h.decision === "GO"
                            ? "rgba(46,125,50,0.08)"
                            : "rgba(211,47,47,0.08)",
                        borderLeft:
                          h.decision === "GO"
                            ? "4px solid #2e7d32"
                            : "4px solid #d32f2f",
                        fontSize: 13,
                      }}
                    >
                      <Box display="flex" justifyContent="space-between">
                        <Typography fontWeight={600}>{h.uid}</Typography>
                        <Typography fontWeight={600}>{h.decision}</Typography>
                      </Box>

                      <Typography mt={0.5}>
                        {h.trip_state} | ₹{h.fare} | Bal ₹{h.remaining_balance}
                      </Typography>

                      <Typography fontSize={11} color="gray" mt={0.5}>
                        {new Date(h.ts * 1000).toLocaleTimeString()}
                      </Typography>
                    </Box>
                  ))
                )}
              </Box>
            </Box>
          </Paper>
        </Grid>
      </Grid>

{/* //Device: {deviceData?.name} - {deviceData?.model} */}
      {/* <Settings deviceName={deviceData?.name} model={deviceData?.model} />
      <View /> */}
    </Box>
  );
}

const EnhancedRow = ({ icon, label, value, bold = false }: any) => (
  <Box
    sx={{
      display: "grid",
      gridTemplateColumns: "32px 160px 1fr",
      alignItems: "center",
      columnGap: 4,
    }}
  >
    <Box sx={{ color: "#1f4f82", display: "flex" }}>{icon}</Box>

    <Typography
      sx={{
        fontWeight: 600,
        color: "#1f4f82",
      }}
    >
      {label}
    </Typography>

    <Typography
      sx={{
        fontWeight: bold ? 700 : 500,
        color: "#1f4f82",
      }}
    >
      {value}
    </Typography>
  </Box>
);

const ResultRow = ({ label, value }: any) => (
  <Box
    sx={{
      display: "flex",
      justifyContent: "space-between",
      fontSize: 11,
      mb: 0.5,
    }}
  >
    <span style={{ opacity: 0.7 }}>{label}</span>
    <span style={{ fontWeight: 600 }}>{value}</span>
  </Box>
);

export default ListDevice;
