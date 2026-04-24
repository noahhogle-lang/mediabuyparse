import { useState, useRef, useCallback } from "react";

const ANTHROPIC_API_KEY = "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";

const SYSTEM_PROMPT = `You are a media buy data extraction specialist for KWME, a Hawaii media buying agency. You read PDF contracts and proposals from radio and TV stations and extract every piece of data a media buyer needs to enter into Strata.

Return ONLY a valid JSON object. No markdown, no explanation, just the JSON.

{
  "vendor_name": "e.g. iHeartMedia",
  "vendor_format": "iHeartMedia|PacificRadioGroup|GrayMedia|TAPSCAN|Radius|SalesOrder|TVContract|Unknown",
  "station": "e.g. KSSK-FM",
  "advertiser": "e.g. Charter Hawaii Spectrum",
  "agency": "e.g. KWME",
  "market": "e.g. HONOLULU-HI",
  "product": "e.g. Spectrum GM KSSK Spot Radio 2025",
  "flight_start": "MM/DD/YY",
  "flight_end": "MM/DD/YY",
  "demo": "e.g. P25-54",
  "ae_name": "",
  "contract_number": "",
  "spot_length": 30,
  "total_spots": 0,
  "gross_total": 0,
  "net_total": 0,
  "agency_commission_pct": 15,
  "net_with_tax": 0,
  "total_impressions": 0,
  "total_grps": 0,
  "reach_pct": 0,
  "frequency": 0,
  "strata_entry_rows": [
    {
      "row_number": 1,
      "week_start": "MM/DD/YY",
      "week_end": "MM/DD/YY",
      "days": "Mo-Fr",
      "time_start": "6:00AM",
      "time_end": "10:00AM",
      "daypart_label": "Morning Drive",
      "spot_length": 30,
      "spots_this_week": 0,
      "unit_rate": 0,
      "gross_cost": 0,
      "net_cost": 0,
      "is_bonus": false,
      "rating": 0,
      "impressions": 0,
      "notes": ""
    }
  ],
  "monthly_totals": [
    { "month": "Jan/25", "spots": 0, "gross": 0, "net": 0 }
  ]
}

RULES:
- strata_entry_rows = every single line that needs to be entered in Strata, one row per week per daypart
- Include dollar-zero bonus/comp/added-value spots, mark is_bonus: true
- For iHeartMedia: each week section has multiple daypart rows, one entry per daypart per week
- For TAPSCAN/Summit: parse each month block, each daypart row is one entry
- For Radius/Eastlan: parse by station and flight date
- For Sales Order or Broadcast Contract: each numbered line is one entry
- net_with_tax = net_total * 1.04712
- Default agency commission to 15% if not stated
- rating = AQH or RTG value from document`;

function fmt$(n) {
  if (n === null || n === undefined || n === "") return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtN(n) {
  if (!n && n !== 0) return "—";
  return Number(n).toLocaleString();
}

function downloadCSV(data, filename) {
  const headers = [
    "Year","Week","Market","Business Unit","Product","Campaign",
    "Deliverable/Media","Parent Company","Station",
    "Total Net w/Tax","Impressions","Total Spots","Total GRPs",
    "Daypart","Days","Time Start","Time End","Spot Length",
    "Unit Rate","Gross Cost","Net Cost","Is Bonus","Rating","Week Start","Week End"
  ];
  const rows = [headers];
  (data.strata_entry_rows || []).forEach(row => {
    const d2 = new Date(row.week_start);
    const yr = d2.getFullYear() || new Date().getFullYear();
    const wk = Math.ceil(((d2 - new Date(yr, 0, 1)) / 86400000 + 1) / 7);
    rows.push([
      yr, wk || "",
      data.market || "HONOLULU-HI", "",
      data.product || "", "",
      data.station?.includes("FM") || data.station?.includes("AM") ? "Radio" : "TV",
      data.vendor_name || "", data.station || "",
      ((row.net_cost || 0) * 1.04712).toFixed(2),
      row.impressions || "", row.spots_this_week || 0, row.grps || "",
      row.daypart_label || "", row.days || "",
      row.time_start || "", row.time_end || "",
      row.spot_length || 30, row.unit_rate || 0,
      row.gross_cost || 0, row.net_cost || 0,
      row.is_bonus ? "YES" : "NO",
      row.rating || "", row.week_start || "", row.week_end || ""
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const VENDOR_COLORS = {
  iHeartMedia: "#C8102E", PacificRadioGroup: "#1B5E8A",
  GrayMedia: "#0D7377", TAPSCAN: "#2E7D32",
  Radius: "#6A1B9A", SalesOrder: "#BF6900",
  TVContract: "#1565C0", Unknown: "#455A64"
};

function StrataCard({ row, index }) {
  const [copied, setCopied] = useState(null);
  const copy = (val, key) => {
    if (val === undefined || val === "" || val === null) return;
    navigator.clipboard.writeText(String(val));
    setCopied(key);
    setTimeout(() => setCopied(null), 1200);
  };

  const Field = ({ label, value, hi }) => (
    <div onClick={() => copy(value, label)}
      style={{
        background: hi ? "#1A2F1A" : "#0D1117",
        border: `1px solid ${copied === label ? "#56D364" : "#21262D"}`,
        borderRadius: 4, padding: "6px 10px",
        cursor: (value !== undefined && value !== "" && value !== null) ? "pointer" : "default",
        transition: "border-color 0.2s", minWidth: 0
      }}
      title={(value !== undefined && value !== "") ? "Click to copy" : ""}>
      <div style={{ fontSize: 9, color: "#484F58", letterSpacing: "0.1em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: copied === label ? "#56D364" : hi ? "#A8D5A2" : "#E8EDF2", fontWeight: hi ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {copied === label ? "✓ Copied!" : (value !== undefined && value !== "" && value !== null ? String(value) : "—")}
      </div>
    </div>
  );

  return (
    <div style={{
      background: "#161B22",
      border: `1px solid ${row.is_bonus ? "#1B3A5C" : "#21262D"}`,
      borderLeft: `3px solid ${row.is_bonus ? "#58A6FF" : "#F0A500"}`,
      borderRadius: 6, padding: 12, marginBottom: 8
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#21262D", color: "#8B949E", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {index + 1}
          </div>
          <span style={{ fontSize: 12, color: "#E8EDF2", fontWeight: 600 }}>
            {row.week_start} – {row.week_end}
          </span>
          <span style={{ fontSize: 11, color: "#8B949E" }}>
            {row.daypart_label || `${row.days} ${row.time_start}–${row.time_end}`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {row.is_bonus && <span style={{ background: "#1B3A5C", color: "#58A6FF", fontSize: 9, padding: "2px 8px", borderRadius: 3, letterSpacing: "0.1em" }}>BONUS</span>}
          <span style={{ fontSize: 11, color: row.is_bonus ? "#8B949E" : "#56D364" }}>
            {row.spots_this_week} spots · {fmt$(row.gross_cost)}
          </span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
        <Field label="DAYS" value={row.days} />
        <Field label="TIME START" value={row.time_start} />
        <Field label="TIME END" value={row.time_end} />
        <Field label="LENGTH" value={row.spot_length ? `:${row.spot_length}` : ":30"} />
        <Field label="SPOTS / WEEK" value={row.spots_this_week} hi={true} />
        <Field label="UNIT RATE $" value={row.unit_rate} hi={!row.is_bonus} />
        <Field label="RATING" value={row.rating || ""} />
        <Field label="GROSS COST" value={row.gross_cost} />
      </div>
      {row.notes && <div style={{ marginTop: 6, fontSize: 10, color: "#8B949E", fontStyle: "italic" }}>Note: {row.notes}</div>}
    </div>
  );
}

export default function App() {
  const [results, setResults] = useState([]);
  const [processing, setProcessing] = useState({});
  const [activeTab, setActiveTab] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [view, setView] = useState("entry");
  const fileInputRef = useRef();

  const processFile = useCallback(async (file, fileId) => {
    setProcessing(p => ({ ...p, [fileId]: { status: "Reading PDF...", pct: 15 } }));
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    setProcessing(p => ({ ...p, [fileId]: { status: "AI extracting data...", pct: 55 } }));
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              { type: "text", text: "Extract all media buy data from this contract/proposal. Return only the JSON." }
            ]
          }]
        })
      });
      setProcessing(p => ({ ...p, [fileId]: { status: "Organizing results...", pct: 88 } }));
      const apiData = await resp.json();
      const raw = apiData.content?.[0]?.text || "{}";
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
      catch { parsed = { error: "Could not parse AI response", raw_response: raw.substring(0, 400) }; }
      if (!parsed.net_with_tax && parsed.net_total) {
        parsed.net_with_tax = +(parsed.net_total * 1.04712).toFixed(2);
      }
      setResults(prev => [...prev, { id: fileId, filename: file.name, data: parsed }]);
      setActiveTab(fileId);
      setView("entry");
    } catch (err) {
      setResults(prev => [...prev, { id: fileId, filename: file.name, data: { error: err.message } }]);
      setActiveTab(fileId);
    } finally {
      setProcessing(p => { const n = { ...p }; delete n[fileId]; return n; });
    }
  }, []);

  const handleFiles = useCallback((fileList) => {
    Array.from(fileList).filter(f => f.name.toLowerCase().endsWith(".pdf")).forEach(file => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      processFile(file, id);
    });
  }, [processFile]);

  const active = results.find(r => r.id === activeTab);
  const d = active?.data;
  const vc = d ? (VENDOR_COLORS[d.vendor_format] || VENDOR_COLORS.Unknown) : "#455A64";
  const rows = d?.strata_entry_rows || [];
  const paidRows = rows.filter(r => !r.is_bonus);
  const bonusRows = rows.filter(r => r.is_bonus);
  const calcSpots = rows.reduce((s, r) => s + (Number(r.spots_this_week) || 0), 0);
  const calcGross = rows.reduce((s, r) => s + (Number(r.gross_cost) || 0), 0);

  return (
    <div style={{ fontFamily: "'DM Mono','Courier New',monospace", background: "#0D1117", minHeight: "100vh", color: "#E8EDF2", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#0D1117}::-webkit-scrollbar-thumb{background:#30363D;border-radius:3px}
        .btn{cursor:pointer;border:none;border-radius:4px;padding:7px 14px;font-family:inherit;font-size:11px;letter-spacing:.06em;font-weight:500;transition:all .15s}
        .btn:hover{filter:brightness(1.15);transform:translateY(-1px)}
        .slide{animation:slide .25s ease}
        @keyframes slide{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .pulse{animation:pulse 1.4s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
        table{border-collapse:collapse;width:100%}
        th{background:#161B22;color:#8B949E;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:8px 10px;text-align:left;border-bottom:1px solid #21262D}
        td{padding:7px 10px;font-size:11px;border-bottom:1px solid #161B22}
        tr:hover td{background:#161B22}
      `}</style>

      {/* HEADER */}
      <div style={{ background:"#161B22", borderBottom:"1px solid #21262D", padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:30, height:30, background:"#F0A500", borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D1117" strokeWidth="2.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <div>
            <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:14 }}>
              MEDIABUY<span style={{ color:"#F0A500" }}>PARSE</span>
              <span style={{ fontSize:10, color:"#484F58", marginLeft:10, fontWeight:400 }}>Strata Entry Assistant · KWME</span>
            </div>
          </div>
        </div>
        {results.length > 0 && (
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <span style={{ fontSize:10, color:"#484F58" }}>{results.length} doc{results.length>1?"s":""} loaded</span>
            <button className="btn" style={{ background:"#21262D", color:"#8B949E" }}
              onClick={() => { setResults([]); setActiveTab(null); }}>CLEAR</button>
          </div>
        )}
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden", height:"calc(100vh - 54px)" }}>

        {/* SIDEBAR */}
        <div style={{ width:220, background:"#161B22", borderRight:"1px solid #21262D", display:"flex", flexDirection:"column", flexShrink:0, overflowY:"auto" }}>
          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);handleFiles(e.dataTransfer.files)}}
            onClick={()=>fileInputRef.current?.click()}
            style={{ margin:10, borderRadius:6, padding:"18px 10px", border:`2px dashed ${dragOver?"#F0A500":"#30363D"}`, background:dragOver?"rgba(240,165,0,0.05)":"transparent", textAlign:"center", cursor:"pointer", transition:"all .2s" }}>
            <input ref={fileInputRef} type="file" accept=".pdf" multiple style={{ display:"none" }}
              onChange={e=>handleFiles(e.target.files)} />
            <div style={{ fontSize:22, marginBottom:6 }}>📄</div>
            <div style={{ fontSize:11, color:dragOver?"#F0A500":"#8B949E" }}>DROP CONTRACT PDFs</div>
            <div style={{ fontSize:10, color:"#484F58", marginTop:3 }}>or click to browse</div>
          </div>

          <div style={{ padding:"0 10px 10px", borderBottom:"1px solid #21262D" }}>
            <div style={{ fontSize:9, color:"#484F58", letterSpacing:"0.1em", marginBottom:5 }}>READS FORMATS FROM</div>
            {[["iHeartMedia","#C8102E"],["TAPSCAN / Nielsen","#2E7D32"],["Pacific Radio","#1B5E8A"],["Gray / WideOrbit","#0D7377"],["Radius / Eastlan","#6A1B9A"],["Sales Orders","#BF6900"]].map(([n,c])=>(
              <div key={n} style={{ fontSize:10, color:"#8B949E", padding:"2px 0", display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:c, flexShrink:0 }} />{n}
              </div>
            ))}
          </div>

          <div style={{ flex:1 }}>
            {Object.entries(processing).map(([id, state])=>(
              <div key={id} style={{ padding:"10px", borderBottom:"1px solid #21262D" }}>
                <div style={{ fontSize:10, color:"#F0A500", marginBottom:5 }} className="pulse">⟳ {state.status}</div>
                <div style={{ height:3, background:"#21262D", borderRadius:2 }}>
                  <div style={{ width:`${state.pct}%`, height:"100%", background:"#F0A500", borderRadius:2, transition:"width 0.6s ease" }} />
                </div>
              </div>
            ))}
            {results.map(r=>{
              const isActive = activeTab===r.id;
              const color = VENDOR_COLORS[r.data?.vendor_format]||VENDOR_COLORS.Unknown;
              return (
                <div key={r.id} onClick={()=>{setActiveTab(r.id);setView("entry")}}
                  style={{ padding:"10px", cursor:"pointer", background:isActive?"#0D1117":"transparent", borderLeft:`3px solid ${isActive?color:"transparent"}`, borderBottom:"1px solid #21262D", transition:"all .15s" }}>
                  <div style={{ fontSize:11, color:isActive?"#E8EDF2":"#8B949E", marginBottom:4, wordBreak:"break-word", lineHeight:1.3 }}>
                    {r.filename.replace(/\.pdf$/i,"")}
                  </div>
                  {r.data?.station && <div style={{ fontSize:11, color, fontWeight:600 }}>{r.data.station}</div>}
                  {r.data?.vendor_format && (
                    <div style={{ fontSize:9, color:"#484F58", marginTop:2, letterSpacing:"0.08em" }}>
                      {r.data.vendor_format} · {r.data?.strata_entry_rows?.length||0} rows
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* MAIN */}
        <div style={{ flex:1, overflowY:"auto", padding: active ? 18 : 0 }}>
          {!active ? (
            <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:14, color:"#484F58" }}>
              <div style={{ fontSize:40 }}>📋</div>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:16 }}>Drop a contract PDF to begin</div>
              <div style={{ fontSize:11, textAlign:"center", maxWidth:320, lineHeight:1.8, color:"#30363D" }}>
                The AI reads the contract and lays out every line in the order you enter it into Strata. Click any value to copy it directly.
              </div>
            </div>
          ) : d?.error ? (
            <div style={{ background:"#2D1515", border:"1px solid #7D2B2B", borderRadius:6, padding:16, color:"#F78166" }}>
              <div style={{ fontWeight:600, marginBottom:6 }}>Extraction Error</div>
              <div style={{ fontSize:11 }}>{d.error}</div>
            </div>
          ) : (
            <div className="slide">

              {/* TOP BAR */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <span style={{ background:vc+"22", color:vc, fontSize:10, padding:"2px 8px", borderRadius:3, letterSpacing:"0.08em" }}>
                      {d.vendor_name||d.vendor_format}
                    </span>
                    <span style={{ fontSize:10, color:"#484F58" }}>{d.flight_start} – {d.flight_end} · {d.demo}</span>
                  </div>
                  <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:20, fontWeight:700 }}>{d.station}</div>
                  <div style={{ fontSize:11, color:"#8B949E", marginTop:2 }}>
                    {d.advertiser} · {d.agency} · {d.market}{d.contract_number?` · #${d.contract_number}`:""}
                  </div>
                </div>
                <div style={{ display:"flex", gap:8, flexShrink:0 }}>
                  <button className="btn" style={{ background:view==="entry"?"#F0A500":"#21262D", color:view==="entry"?"#0D1117":"#8B949E" }} onClick={()=>setView("entry")}>STRATA ENTRY</button>
                  <button className="btn" style={{ background:view==="summary"?"#F0A500":"#21262D", color:view==="summary"?"#0D1117":"#8B949E" }} onClick={()=>setView("summary")}>SUMMARY</button>
                  <button className="btn" style={{ background:"#1E4620", color:"#56D364" }}
                    onClick={()=>downloadCSV(d, active.filename.replace(/\.pdf$/i,"_tableau.csv"))}>↓ TABLEAU CSV</button>
                </div>
              </div>

              {/* STATS */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:8, marginBottom:16 }}>
                {[
                  { label:"Total Spots", value:fmtN(d.total_spots), color:"#E8EDF2" },
                  { label:"Gross Total", value:fmt$(d.gross_total), color:"#F0A500" },
                  { label:"Net Total", value:fmt$(d.net_total), color:"#56D364" },
                  { label:"Net + HI Tax", value:fmt$(d.net_with_tax), color:"#58A6FF" },
                  { label:"Impressions", value:fmtN(d.total_impressions), color:"#E8EDF2" },
                  { label:"Reach / Freq", value:d.reach_pct?`${d.reach_pct}% / ${d.frequency}x`:"—", color:"#E8EDF2" },
                ].map(s=>(
                  <div key={s.label} style={{ background:"#161B22", border:"1px solid #21262D", borderRadius:5, padding:"10px 12px" }}>
                    <div style={{ fontSize:9, color:"#484F58", letterSpacing:"0.1em", marginBottom:3 }}>{s.label}</div>
                    <div style={{ fontSize:15, fontFamily:"'Space Grotesk',sans-serif", fontWeight:600, color:s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* VALIDATION */}
              <div style={{ background:"#161B22", border:"1px solid #21262D", borderRadius:5, padding:"10px 14px", marginBottom:16, display:"flex", gap:20, flexWrap:"wrap", alignItems:"center" }}>
                <div style={{ fontSize:10, color:"#8B949E", letterSpacing:"0.1em" }}>VALIDATION</div>
                {[
                  { label:"Spots", ok: d.total_spots && Math.abs(d.total_spots-calcSpots)<=2, detail:`PDF: ${fmtN(d.total_spots)} · Extracted: ${fmtN(calcSpots)}` },
                  { label:"Gross $", ok: d.gross_total && Math.abs(d.gross_total-calcGross)<=5, detail:`PDF: ${fmt$(d.gross_total)} · Extracted: ${fmt$(calcGross)}` },
                  { label:"Net < Gross", ok: d.net_total < d.gross_total, detail:`${d.gross_total>0?((d.net_total/d.gross_total)*100).toFixed(1):0}% of gross` },
                  { label:"Tax Applied", ok: d.net_with_tax > d.net_total, detail:`${fmt$(d.net_total)} → ${fmt$(d.net_with_tax)}` },
                ].map(v=>(
                  <div key={v.label} style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <div style={{ width:18, height:18, borderRadius:"50%", background:v.ok?"#1E4620":"#3D1A1A", color:v.ok?"#56D364":"#F78166", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700 }}>
                      {v.ok?"✓":"!"}
                    </div>
                    <div>
                      <div style={{ fontSize:11 }}>{v.label}</div>
                      <div style={{ fontSize:9, color:"#8B949E" }}>{v.detail}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ENTRY VIEW */}
              {view==="entry" && (
                <div>
                  <div style={{ fontSize:10, color:"#8B949E", letterSpacing:"0.1em", marginBottom:10, display:"flex", justifyContent:"space-between" }}>
                    <span>STRATA ENTRY GUIDE — click any field to copy that value</span>
                    <span>{paidRows.length} paid · {bonusRows.length} bonus/added-value</span>
                  </div>
                  {paidRows.length>0 && (
                    <div style={{ marginBottom:16 }}>
                      <div style={{ fontSize:10, color:"#56D364", letterSpacing:"0.1em", marginBottom:8, paddingBottom:4, borderBottom:"1px solid #1E4620" }}>
                        PAID SPOTS ({paidRows.length})
                      </div>
                      {paidRows.map((row,i)=><StrataCard key={i} row={row} index={i}/>)}
                    </div>
                  )}
                  {bonusRows.length>0 && (
                    <div>
                      <div style={{ fontSize:10, color:"#58A6FF", letterSpacing:"0.1em", marginBottom:8, paddingBottom:4, borderBottom:"1px solid #1B3A5C" }}>
                        BONUS / COMP / ADDED VALUE ({bonusRows.length}) — enter in Strata at $0
                      </div>
                      {bonusRows.map((row,i)=><StrataCard key={i} row={row} index={i}/>)}
                    </div>
                  )}
                  {rows.length===0 && (
                    <div style={{ textAlign:"center", padding:40, color:"#484F58" }}>No line items extracted. PDF may be image-only or unrecognized format.</div>
                  )}
                </div>
              )}

              {/* SUMMARY VIEW */}
              {view==="summary" && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                  {d.monthly_totals?.length>0 && (
                    <div style={{ background:"#161B22", border:"1px solid #21262D", borderRadius:6, overflow:"hidden" }}>
                      <div style={{ padding:"10px 14px", borderBottom:"1px solid #21262D", fontSize:10, color:"#8B949E", letterSpacing:"0.1em" }}>MONTHLY TOTALS</div>
                      <table>
                        <thead><tr><th>Month</th><th>Spots</th><th>Gross</th><th>Net</th><th>Net+Tax</th></tr></thead>
                        <tbody>
                          {d.monthly_totals.map((m,i)=>(
                            <tr key={i}>
                              <td style={{ fontWeight:600 }}>{m.month}</td>
                              <td style={{ color:"#8B949E" }}>{fmtN(m.spots)}</td>
                              <td style={{ color:"#F0A500" }}>{fmt$(m.gross)}</td>
                              <td style={{ color:"#56D364" }}>{fmt$(m.net)}</td>
                              <td style={{ color:"#58A6FF" }}>{fmt$(m.net*1.04712)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div style={{ background:"#161B22", border:"1px solid #21262D", borderRadius:6, overflow:"hidden" }}>
                    <div style={{ padding:"10px 14px", borderBottom:"1px solid #21262D", fontSize:10, color:"#8B949E", letterSpacing:"0.1em" }}>ALL LINE ITEMS — {rows.length} total</div>
                    <div style={{ maxHeight:400, overflowY:"auto" }}>
                      <table>
                        <thead><tr><th>Week</th><th>Daypart</th><th>Spots</th><th>Rate</th><th>Gross</th><th>Type</th></tr></thead>
                        <tbody>
                          {rows.map((row,i)=>(
                            <tr key={i}>
                              <td style={{ color:"#8B949E", fontSize:10, whiteSpace:"nowrap" }}>{row.week_start}</td>
                              <td style={{ fontSize:10 }}>{row.daypart_label||`${row.days} ${row.time_start}`}</td>
                              <td>{row.spots_this_week}</td>
                              <td style={{ color:"#8B949E" }}>{row.unit_rate>0?fmt$(row.unit_rate):"—"}</td>
                              <td style={{ color:row.is_bonus?"#484F58":"#F0A500" }}>{fmt$(row.gross_cost)}</td>
                              <td><span style={{ color:row.is_bonus?"#58A6FF":"#56D364", fontSize:9 }}>{row.is_bonus?"BONUS":"PAID"}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
