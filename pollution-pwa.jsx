import { createContext, useContext, useEffect, useState } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from "recharts";

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --n950:#060d1a;--n900:#0a1628;--n800:#0f2040;--n700:#162d52;--n600:#1e3a64;
    --s400:#94a3b8;--s300:#cbd5e1;--s200:#e2e8f0;--white:#f8fafc;
    --amber:#d97706;--amber-lt:#fbbf24;--red:#dc2626;--red-lt:#ef4444;
    --green:#16a34a;--green-lt:#22c55e;--orange:#c2410c;--orange-lt:#f97316;
    --purple:#7c3aed;--blue:#3b82f6;
    --border:rgba(148,163,184,0.12);--border-md:rgba(148,163,184,0.22);
  }
  html,body,#root{height:100%;background:var(--n950);}
  body{font-family:'IBM Plex Sans',sans-serif;color:var(--white);-webkit-font-smoothing:antialiased;}
  .mono{font-family:'IBM Plex Mono',monospace;}
  ::-webkit-scrollbar{width:3px;height:3px;}
  ::-webkit-scrollbar-thumb{background:var(--n600);border-radius:2px;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pring{0%{transform:scale(1);opacity:.8}100%{transform:scale(2.2);opacity:0}}
  @keyframes scan{0%{transform:translateY(-100%)}100%{transform:translateY(500%)}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
  .fade-up{animation:fadeUp .35s ease forwards;}
  .blink{animation:blink 1.4s infinite;}
  .panel{background:var(--n900);border:1px solid var(--border);border-radius:3px;}
  .panel-md{background:var(--n800);border:1px solid var(--border-md);border-radius:3px;}
  .hover-row:hover{background:rgba(59,130,246,0.055);}
  .tab-btn{background:none;border:none;cursor:pointer;font-family:'IBM Plex Sans',sans-serif;
    font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;
    color:var(--s400);padding:10px 14px;border-bottom:2px solid transparent;
    transition:color .15s,border-color .15s;white-space:nowrap;}
  .tab-btn.active{color:var(--white);border-bottom-color:var(--blue);}
  .tab-btn:hover:not(.active){color:var(--s200);}
  .btn-p{background:var(--blue);color:#fff;border:none;cursor:pointer;
    font-family:'IBM Plex Sans',sans-serif;font-size:10px;font-weight:600;
    letter-spacing:.06em;text-transform:uppercase;padding:6px 12px;border-radius:2px;
    transition:opacity .15s;}
  .btn-p:hover{opacity:.82;}
  .btn-g{background:transparent;border:1px solid var(--border-md);color:var(--s300);cursor:pointer;
    font-family:'IBM Plex Sans',sans-serif;font-size:10px;font-weight:500;letter-spacing:.05em;
    padding:5px 10px;border-radius:2px;transition:border-color .15s,color .15s;}
  .btn-g:hover{border-color:var(--s300);color:var(--white);}
  .sdot{display:inline-block;width:6px;height:6px;border-radius:50%;flex-shrink:0;position:relative;}
  .sdot.live::after{content:'';position:absolute;inset:-3px;border-radius:50%;animation:pring 1.8s ease-out infinite;}
  .sdot.grn{background:var(--green-lt);}
  .sdot.grn::after{border:1.5px solid var(--green-lt);}
  .sdot.red{background:var(--red-lt);}
  .sdot.red::after{border:1.5px solid var(--red-lt);}
  .sdot.amb{background:var(--amber-lt);}
  .sdot.amb::after{border:1.5px solid var(--amber-lt);}
  .nav-item{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0;flex:1;
    background:none;border:none;cursor:pointer;font-family:'IBM Plex Sans',sans-serif;
    font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
    color:var(--s400);transition:color .15s;border-top:2px solid transparent;}
  .nav-item.active{color:var(--white);border-top-color:var(--blue);}
  .badge{display:inline-flex;align-items:center;padding:1px 7px;border-radius:1px;
    font-size:9px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;font-family:'IBM Plex Mono',monospace;}
  .scan-line{position:absolute;left:0;right:0;height:1px;
    background:linear-gradient(90deg,transparent,rgba(59,130,246,.35),transparent);
    animation:scan 3.5s linear infinite;pointer-events:none;}
  .ward-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:3px;}
  .ward-cell{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;
    justify-content:center;cursor:pointer;border-radius:2px;
    transition:transform .12s,opacity .12s;position:relative;overflow:hidden;}
  .ward-cell:hover{transform:scale(1.06);}
  .ward-cell.sel{outline:2px solid #fff;outline-offset:1px;}
  .abar{height:3px;border-radius:2px;background:var(--n700);}
  .afill{height:100%;border-radius:2px;transition:width 1s cubic-bezier(.4,0,.2,1);}
  .sl{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
    color:var(--s400);display:flex;align-items:center;gap:8px;margin-bottom:10px;}
  .sl::after{content:'';flex:1;height:1px;background:var(--border);}
  .tt{background:var(--n800)!important;border:1px solid var(--border-md)!important;
    border-radius:2px!important;font-family:'IBM Plex Mono',monospace!important;
    font-size:10px!important;padding:7px 11px!important;
    box-shadow:0 8px 32px rgba(0,0,0,.45)!important;}
`;

// â”€â”€â”€ DATA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const WARDS = [
  {id:1, name:"Civil Lines",      sector:"North",   aqi:142,pm25:58, pm10:82, no2:28,so2:12,o3:18,co:0.8,sensors:3,status:"active"},
  {id:2, name:"Model Town",       sector:"North",   aqi:89, pm25:35, pm10:52, no2:22,so2:8, o3:14,co:0.5,sensors:2,status:"active"},
  {id:3, name:"Sector 12",        sector:"East",    aqi:201,pm25:82, pm10:110,no2:38,so2:18,o3:24,co:1.2,sensors:4,status:"active"},
  {id:4, name:"Old Grain Market", sector:"Central", aqi:267,pm25:110,pm10:145,no2:45,so2:22,o3:28,co:1.8,sensors:3,status:"active"},
  {id:5, name:"Bus Stand",        sector:"Central", aqi:178,pm25:72, pm10:96, no2:35,so2:16,o3:20,co:1.1,sensors:2,status:"active"},
  {id:6, name:"Railway Road",     sector:"South",   aqi:312,pm25:130,pm10:168,no2:52,so2:28,o3:32,co:2.1,sensors:4,status:"alert"},
  {id:7, name:"GT Road North",    sector:"North",   aqi:388,pm25:158,pm10:198,no2:62,so2:35,o3:38,co:2.8,sensors:5,status:"critical"},
  {id:8, name:"Kunjpura",         sector:"North",   aqi:55, pm25:20, pm10:32, no2:15,so2:5, o3:10,co:0.3,sensors:2,status:"active"},
  {id:9, name:"Sector 6",         sector:"East",    aqi:124,pm25:50, pm10:70, no2:25,so2:11,o3:16,co:0.7,sensors:3,status:"active"},
  {id:10,name:"Assandh Road",     sector:"East",    aqi:165,pm25:66, pm10:90, no2:32,so2:14,o3:21,co:1.0,sensors:2,status:"active"},
  {id:11,name:"Taraori Road",     sector:"West",    aqi:98, pm25:38, pm10:55, no2:20,so2:9, o3:13,co:0.6,sensors:2,status:"active"},
  {id:12,name:"HUDA Sector 13",   sector:"West",    aqi:73, pm25:28, pm10:42, no2:18,so2:7, o3:11,co:0.4,sensors:3,status:"active"},
  {id:13,name:"Industrial Area",  sector:"South",   aqi:445,pm25:185,pm10:230,no2:75,so2:48,o3:45,co:3.5,sensors:6,status:"critical"},
  {id:14,name:"Karnal Main",      sector:"Central", aqi:178,pm25:72, pm10:98, no2:36,so2:15,o3:22,co:1.1,sensors:4,status:"active"},
  {id:15,name:"Nilokheri Road",   sector:"South",   aqi:136,pm25:54, pm10:78, no2:27,so2:12,o3:17,co:0.9,sensors:3,status:"active"},
];
const MY_WARD = WARDS[13];
const CITY_AVG = Math.round(WARDS.reduce((s,w)=>s+w.aqi,0)/WARDS.length);

function aqiCfg(v){
  if(v<=50)  return{label:"GOOD",     color:"#16a34a",dim:"#14532d"};
  if(v<=100) return{label:"SATISF.",  color:"#ca8a04",dim:"#713f12"};
  if(v<=150) return{label:"MODERATE", color:"#c2410c",dim:"#7c2d12"};
  if(v<=200) return{label:"POOR",     color:"#dc2626",dim:"#7f1d1d"};
  if(v<=300) return{label:"V.POOR",   color:"#9333ea",dim:"#4a1d96"};
  return           {label:"SEVERE",   color:"#6d28d9",dim:"#2e1065"};
}

const HOURLY=[
  {h:"00",aqi:88},{h:"01",aqi:72},{h:"02",aqi:65},{h:"03",aqi:61},{h:"04",aqi:58},
  {h:"05",aqi:75},{h:"06",aqi:112},{h:"07",aqi:148},{h:"08",aqi:168},{h:"09",aqi:175},
  {h:"10",aqi:178},{h:"11",aqi:172},{h:"12",aqi:165},{h:"13",aqi:158},{h:"14",aqi:162},
  {h:"15",aqi:170},{h:"16",aqi:178},{h:"17",aqi:190},{h:"18",aqi:205},{h:"19",aqi:198},
  {h:"20",aqi:185},{h:"21",aqi:168},{h:"22",aqi:145},{h:"23",aqi:118},
];
const WEEKLY=[
  {d:"MON",aqi:145,pm25:58,pm10:82},{d:"TUE",aqi:162,pm25:65,pm10:91},
  {d:"WED",aqi:189,pm25:78,pm10:108},{d:"THU",aqi:201,pm25:82,pm10:114},
  {d:"FRI",aqi:178,pm25:72,pm10:98},{d:"SAT",aqi:134,pm25:52,pm10:76},
  {d:"SUN",aqi:148,pm25:60,pm10:84},
];
const POLLUTANTS=[
  {key:"PM2.5",value:72, unit:"Î¼g/mÂ³",safe:60, pct:38,color:"#ef4444"},
  {key:"PM10", value:98, unit:"Î¼g/mÂ³",safe:100,pct:26,color:"#f97316"},
  {key:"NOâ‚‚",  value:36, unit:"ppb",  safe:40, pct:14,color:"#eab308"},
  {key:"SOâ‚‚",  value:15, unit:"ppb",  safe:40, pct:12,color:"#a855f7"},
  {key:"Oâ‚ƒ",   value:22, unit:"ppb",  safe:50, pct:8, color:"#3b82f6"},
  {key:"CO",   value:1.1,unit:"ppm",  safe:4.0,pct:2, color:"#64748b"},
];
const ALERTS_DATA=[
  {id:1,sev:"critical",ward:"Ward 13 â€“ Industrial Area",event:"PM2.5 spike +68% in 30 min",time:"10:42",delta:"+68%",action:"Emergency protocol active"},
  {id:2,sev:"severe",  ward:"Ward 7 â€“ GT Road North",  event:"AQI 388 â€” Severe threshold exceeded",time:"10:17",delta:"+22%",action:"School advisory issued"},
  {id:3,sev:"high",    ward:"Ward 6 â€“ Railway Road",   event:"NOâ‚‚ abnormal near rail depot",time:"09:54",delta:"+41%",action:"Inspection dispatched"},
  {id:4,sev:"moderate",ward:"District-wide",           event:"Wind shift NWâ†’SE predicted 13:00",time:"09:30",delta:"â€”",  action:"Monitoring heightened"},
  {id:5,sev:"high",    ward:"Ward 4 â€“ Grain Market",   event:"PM10 construction source identified",time:"08:15",delta:"+33%",action:"Notice issued to contractor"},
];
const POLICIES=[
  {pri:"P1",ward:"Ward 13",action:"Shut high-emission industrial units for 6h",expected:"AQI âˆ’85",dept:"Industries Dept.",status:"PENDING"},
  {pri:"P1",ward:"Ward 7", action:"Ban heavy vehicles 08:00â€“10:00 & 17:00â€“20:00",expected:"AQI âˆ’42",dept:"Traffic Police",  status:"ACTIVE"},
  {pri:"P2",ward:"Ward 6", action:"Deploy 4 water sprinkler vehicles on arterials",expected:"AQI âˆ’30",dept:"Municipal Corp.", status:"PENDING"},
  {pri:"P2",ward:"Ward 4", action:"Mandate covering of all construction material",expected:"AQI âˆ’25",dept:"Building Dept.",  status:"ISSUED"},
  {pri:"P3",ward:"City",   action:"Anti-stubble burning field inspections",expected:"AQI âˆ’18",dept:"Agriculture",       status:"SCHEDULED"},
  {pri:"P3",ward:"Ward 3", action:"Green belt irrigation frequency +50%",expected:"AQI âˆ’10",dept:"Parks & Gardens",    status:"NORMAL"},
];
const COMPLAINTS=[
  {id:1,ward:"W-13",text:"Continuous black smoke from factory chimney near NH-44 since 06:00",time:"10:38",votes:42,status:"OPEN"},
  {id:2,ward:"W-7", text:"Heavy goods trucks idling on GT Road for extended periods",time:"10:25",votes:28,status:"ASSIGNED"},
  {id:3,ward:"W-4", text:"Open municipal waste burning near grain storage facility",time:"10:02",votes:19,status:"OPEN"},
  {id:4,ward:"W-6", text:"Construction debris left uncovered overnight on arterial road",time:"09:47",votes:15,status:"RESOLVED"},
];

const API_BASE=(typeof window!=="undefined"&&window.__AQI_API_BASE__)||"http://127.0.0.1:8000/v1";
const SECTORS=["North","East","Central","South","West"];
const DataContext=createContext(null);
const DEFAULT_APP_DATA={WARDS,MY_WARD,CITY_AVG,HOURLY,WEEKLY,POLLUTANTS,ALERTS_DATA,POLICIES,COMPLAINTS,FORECAST_3H:210};

function useAppData(){
  return useContext(DataContext)||DEFAULT_APP_DATA;
}

function wardNum(wardId){
  const m=String(wardId||"").match(/(\d+)$/);
  return m?Number(m[1]):0;
}

function wardStatus(aqi){
  if(aqi>300)return "critical";
  if(aqi>200)return "alert";
  return "active";
}

function sevFromLevel(level){
  const l=String(level||"").toLowerCase();
  if(l.includes("severe"))return "critical";
  if(l.includes("high"))return "severe";
  return "moderate";
}

async function getJson(url){
  const res=await fetch(url);
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBackendData(){
  const mapRes=await getJson(`${API_BASE}/ward-map-data?city_id=DELHI`);
  const rows=Array.isArray(mapRes?.data)?mapRes.data:[];
  if(!rows.length)throw new Error("No ward data");

  const wards=rows.map((r,idx)=>{
    const id=wardNum(r.ward_id)||idx+1;
    return{
      id,
      ward_id:r.ward_id,
      name:r.ward_name||`Ward ${id}`,
      sector:SECTORS[idx%SECTORS.length],
      aqi:r.aqi||0,
      pm25:r.pm25||0,
      pm10:r.pm10||0,
      no2:r.no2||0,
      so2:r.so2||0,
      o3:r.o3||0,
      co:r.co||0,
      sensors:2+(id%4),
      status:wardStatus(r.aqi||0),
    };
  });

  const myWard=wards.find(w=>w.ward_id==="DEL_WARD_014")||wards[0];
  const cityAvg=Math.round(wards.reduce((s,w)=>s+w.aqi,0)/Math.max(wards.length,1));

  const [aqiRes,forecast3h,breakdown,alertRes,trendsRes,alertsFeed,recoRes,complaintsRes]=await Promise.all([
    getJson(`${API_BASE}/ward-aqi?ward_id=${myWard.ward_id}`),
    getJson(`${API_BASE}/aqi-forecast?ward_id=${myWard.ward_id}&horizon=3`),
    getJson(`${API_BASE}/pollutant-breakdown?ward_id=${myWard.ward_id}`),
    getJson(`${API_BASE}/alerts?ward_id=${myWard.ward_id}`),
    getJson(`${API_BASE}/analytics/trends?ward_id=${myWard.ward_id}`),
    getJson(`${API_BASE}/alerts/feed?city_id=DELHI&limit=12`),
    getJson(`${API_BASE}/gov/recommendations?city_id=DELHI`),
    getJson(`${API_BASE}/complaints?city_id=DELHI`),
  ]);

  const raw=breakdown?.data?.raw_concentration||{};
  const contrib=breakdown?.data?.contribution_percent||{};
  const mergedWard={
    ...myWard,
    aqi:aqiRes?.data?.aqi??myWard.aqi,
    pm25:raw.pm25??myWard.pm25,
    pm10:raw.pm10??myWard.pm10,
    no2:raw.no2??myWard.no2,
    so2:raw.so2??myWard.so2,
    o3:raw.o3??myWard.o3,
    co:raw.co??myWard.co,
    status:wardStatus(aqiRes?.data?.aqi??myWard.aqi),
  };

  const pollutants=[
    {key:"PM2.5",value:Number(mergedWard.pm25||0),unit:"ug/m3",safe:60,pct:Number(contrib["PM2.5"]||0),color:"#ef4444"},
    {key:"PM10",value:Number(mergedWard.pm10||0),unit:"ug/m3",safe:100,pct:Number(contrib.PM10||0),color:"#f97316"},
    {key:"NO2",value:Number(mergedWard.no2||0),unit:"ppb",safe:40,pct:Number(contrib.NO2||0),color:"#eab308"},
    {key:"SO2",value:Number(mergedWard.so2||0),unit:"ppb",safe:40,pct:Number(contrib.SO2||0),color:"#a855f7"},
    {key:"O3",value:Number(mergedWard.o3||0),unit:"ppb",safe:50,pct:Number(contrib.O3||0),color:"#3b82f6"},
    {key:"CO",value:Number(mergedWard.co||0),unit:"ppm",safe:4.0,pct:Number(contrib.CO||0),color:"#64748b"},
  ];

  const toIstTime=(iso)=>new Date(iso||Date.now()).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false});
  const wardNameById=Object.fromEntries(wards.map(w=>[w.ward_id,`Ward ${w.id} - ${w.name}`]));

  const primaryAlert=alertRes?.data?.active?[{
    id:1,
    sev:sevFromLevel(alertRes.data.level),
    ward:`Ward ${mergedWard.id} - ${mergedWard.name}`,
    event:alertRes.data.reason||"Crisis condition detected",
    time:toIstTime(alertRes.data.started_at_utc),
    delta:"-",
    action:alertRes.data.health_advisory||"Avoid outdoor activity",
  }]:[];

  const feedAlerts=(alertsFeed?.data||[]).map((a)=>({
    id:a.id,
    sev:a.sev||"moderate",
    ward:wardNameById[a.ward_id]||a.ward_id,
    event:a.event||"Incident detected",
    time:toIstTime(a.time_utc),
    delta:"-",
    action:a.action||"Monitor ward conditions",
  }));

  const policies=(recoRes?.data||[]).slice(0,6).map((r)=>({
    pri:r.priority||"P3",
    ward:r.ward_id?.replace("DEL_WARD_","W")||"W-NA",
    action:r.action,
    expected:`AQI ${r.expected_impact||"-10"}`,
    dept:r.department||"District Pollution Control Cell",
    status:r.status||"PENDING",
  }));

  const complaints=(complaintsRes?.data||[]).map((c)=>({
    id:c.id,
    ward:(c.ward_id||"W-NA").replace("DEL_WARD_","W-"),
    text:c.text,
    time:toIstTime(c.time_utc),
    votes:c.votes||0,
    status:c.status||"OPEN",
  }));

  return{
    WARDS:wards.map(w=>w.ward_id===mergedWard.ward_id?mergedWard:w),
    MY_WARD:mergedWard,
    CITY_AVG:cityAvg,
    HOURLY:trendsRes?.data?.hourly||HOURLY,
    WEEKLY:trendsRes?.data?.weekly||WEEKLY,
    POLLUTANTS:pollutants,
    ALERTS_DATA:[...primaryAlert,...feedAlerts].slice(0,8).length?[...primaryAlert,...feedAlerts].slice(0,8):ALERTS_DATA,
    POLICIES:policies.length?policies:POLICIES,
    COMPLAINTS:complaints.length?complaints:COMPLAINTS,
    FORECAST_3H:forecast3h?.data?.aqi_pred||210,
  };
}

// â”€â”€â”€ PRIMITIVES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const Panel=({children,style={},cls=""})=>(
  <div className={`panel ${cls}`} style={style}>{children}</div>
);
const SL=({children})=>(<div className="sl">{children}</div>);
const Badge=({children,color})=>(
  <span className="badge" style={{color,background:color+"1a",border:`1px solid ${color}40`}}>{children}</span>
);
const SDot=({color="grn"})=><span className={`sdot live ${color}`}/>;
const TT=({active,payload,label})=>{
  if(!active||!payload?.length)return null;
  return(
    <div className="tt">
      <div style={{color:"var(--s400)",marginBottom:4,fontSize:9}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color||"var(--white)"}}>{p.name}: <b>{p.value}</b></div>
      ))}
    </div>
  );
};

// â”€â”€â”€ HOME SCREEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function HomeScreen(){
  const {MY_WARD,POLLUTANTS,HOURLY,CITY_AVG,WARDS,FORECAST_3H}=useAppData();
  const cfg=aqiCfg(MY_WARD.aqi);
  const bestWard=[...WARDS].sort((a,b)=>a.aqi-b.aqi)[0]||{id:"-",name:"-",aqi:0};
  const worstWard=[...WARDS].sort((a,b)=>b.aqi-a.aqi)[0]||{id:"-",name:"-",aqi:0};
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10,paddingBottom:72}} className="fade-up">

      {/* Location Row */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"2px 0"}}>
        <div>
          <div style={{fontSize:9,letterSpacing:".14em",textTransform:"uppercase",color:"var(--s400)",marginBottom:2}}>Location Detected</div>
          <div style={{fontSize:14,fontWeight:700,color:"var(--white)"}}>Ward {MY_WARD.id} - {MY_WARD.name}</div>
          <div style={{fontSize:9,color:"var(--s400)",marginTop:1}}>Live backend ward feed - {MY_WARD.ward_id||`W${MY_WARD.id}`}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end",marginBottom:3}}>
            <SDot color="grn"/>
            <span style={{fontSize:9,color:"var(--green-lt)",fontWeight:700,letterSpacing:".1em"}}>LIVE</span>
          </div>
          <div className="mono" style={{fontSize:9,color:"var(--s400)"}}>
            {new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false})} IST
          </div>
        </div>
      </div>

      {/* AQI Hero */}
      <Panel style={{padding:0,overflow:"hidden",position:"relative"}}>
        <div style={{position:"absolute",inset:0,background:`linear-gradient(135deg,${cfg.dim} 0%,var(--n900) 65%)`,opacity:.6}}/>
        <div className="scan-line"/>
        <div style={{position:"relative",padding:"18px 18px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <div>
              <div style={{fontSize:9,letterSpacing:".13em",color:"var(--s400)",textTransform:"uppercase",marginBottom:5}}>National AQI Index</div>
              <div className="mono" style={{fontSize:68,fontWeight:700,color:cfg.color,lineHeight:1,letterSpacing:"-.02em"}}>{MY_WARD.aqi}</div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginTop:6}}>
                <Badge color={cfg.color}>{cfg.label}</Badge>
                <span style={{fontSize:9,color:"var(--s400)"}}>Trending <span style={{color:"#ef4444"}}>+12 pts</span> since 09:00</span>
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:"var(--s400)",marginBottom:6,textTransform:"uppercase",letterSpacing:".09em"}}>3H Forecast</div>
              <div className="mono" style={{fontSize:34,fontWeight:700,color:aqiCfg(FORECAST_3H||210).color,lineHeight:1}}>{FORECAST_3H||210}</div>
              <div style={{marginTop:4}}><Badge color={aqiCfg(FORECAST_3H||210).color}>{aqiCfg(FORECAST_3H||210).label}</Badge></div>
            </div>
          </div>
          {/* Scale bar */}
          <div style={{height:3,borderRadius:2,background:"linear-gradient(90deg,#16a34a 0%,#ca8a04 20%,#c2410c 40%,#dc2626 60%,#9333ea 80%,#6d28d9 100%)",position:"relative",marginBottom:5}}>
            <div style={{position:"absolute",top:"50%",transform:"translate(-50%,-50%)",left:`${Math.min((MY_WARD.aqi/500)*100,97)}%`,width:9,height:9,borderRadius:"50%",background:"var(--white)",border:`2px solid ${cfg.color}`,boxShadow:`0 0 7px ${cfg.color}`}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            {["0","100","200","300","400","500"].map(v=>(
              <span key={v} className="mono" style={{fontSize:8,color:"var(--s400)"}}>{v}</span>
            ))}
          </div>
        </div>
      </Panel>

      {/* Pollutant Grid */}
      <Panel style={{padding:14}}>
        <SL>Pollutant Concentrations</SL>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
          {POLLUTANTS.map(p=>{
            const over=p.value>p.safe;
            const pct=Math.min((p.value/p.safe)*100,100);
            return(
              <div key={p.key} style={{padding:"9px 11px",background:"var(--n800)",borderRadius:2,border:"1px solid var(--border)"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                  <span style={{fontSize:9,fontWeight:700,color:"var(--s300)",letterSpacing:".07em"}}>{p.key}</span>
                  {over&&<span style={{fontSize:8,color:"#ef4444",fontWeight:700}}>ABOVE LIMIT</span>}
                </div>
                <div className="mono" style={{fontSize:18,fontWeight:700,color:p.color,marginBottom:5}}>
                  {p.value}<span style={{fontSize:9,fontWeight:400,color:"var(--s400)",marginLeft:2}}>{p.unit}</span>
                </div>
                <div className="abar"><div className="afill" style={{width:`${pct}%`,background:p.color,opacity:over?1:.7}}/></div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                  <span style={{fontSize:8,color:"var(--s400)"}}>Contrib: {p.pct}%</span>
                  <span style={{fontSize:8,color:"var(--s400)"}}>Limit: {p.safe}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* 24H Trend */}
      <Panel style={{padding:14}}>
        <SL>24-Hour AQI Trend â€” Ward {MY_WARD.id}</SL>
        <ResponsiveContainer width="100%" height={110}>
          <AreaChart data={HOURLY} margin={{top:4,right:4,bottom:0,left:-24}}>
            <defs>
              <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={.25}/>
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="h" tick={{fontSize:8,fill:"#64748b",fontFamily:"IBM Plex Mono"}} axisLine={false} tickLine={false} interval={3}/>
            <YAxis tick={{fontSize:8,fill:"#64748b",fontFamily:"IBM Plex Mono"}} axisLine={false} tickLine={false}/>
            <CartesianGrid vertical={false} stroke="rgba(148,163,184,.05)"/>
            <Tooltip content={<TT/>}/>
            <ReferenceLine y={200} stroke="#9333ea" strokeDasharray="3 3" strokeWidth={1}/>
            <ReferenceLine y={100} stroke="#ca8a04" strokeDasharray="3 3" strokeWidth={1}/>
            <Area type="monotone" dataKey="aqi" stroke="#3b82f6" strokeWidth={1.5} fill="url(#hg)" dot={false} name="AQI"/>
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      {/* Comparison */}
      <Panel style={{padding:14}}>
        <SL>Comparative AQI â€” City District</SL>
        {[
          {label:`Ward ${MY_WARD.id} (Current)`,aqi:MY_WARD.aqi,highlight:true},
          {label:"City Average",aqi:CITY_AVG},
          {label:`Best - W${bestWard.id} ${bestWard.name}`,aqi:bestWard.aqi},
          {label:`Worst - W${worstWard.id} ${worstWard.name}`,aqi:worstWard.aqi},
        ].map(item=>{
          const c=aqiCfg(item.aqi);
          return(
            <div key={item.label} style={{display:"flex",alignItems:"center",gap:10,padding:item.highlight?"7px 9px":"3px 0",background:item.highlight?"var(--n800)":"transparent",borderRadius:2,border:item.highlight?"1px solid var(--border-md)":"none",marginBottom:5}}>
              <div style={{width:95,fontSize:10,color:item.highlight?"var(--white)":"var(--s400)",fontWeight:item.highlight?600:400,flexShrink:0}}>{item.label}</div>
              <div style={{flex:1}}><div className="abar" style={{height:item.highlight?4:3}}><div className="afill" style={{width:`${(item.aqi/500)*100}%`,background:c.color}}/></div></div>
              <div className="mono" style={{fontSize:11,fontWeight:700,color:c.color,width:30,textAlign:"right"}}>{item.aqi}</div>
              <div style={{width:55,textAlign:"right"}}><Badge color={c.color}>{c.label}</Badge></div>
            </div>
          );
        })}
      </Panel>

      {/* Health Advisory */}
      <Panel style={{padding:14,borderColor:"rgba(220,38,38,.3)",background:"rgba(127,29,29,.12)"}}>
        <SL>Health Advisory â€” AQI {MY_WARD.aqi}</SL>
        {[
          {group:"General Population",advice:"Reduce prolonged outdoor exertion. Use N95 respirator if outdoors."},
          {group:"Children & Elderly",advice:"Avoid outdoor activity. HEPA air purifier recommended indoors."},
          {group:"Cardiovascular / Respiratory",advice:"Remain indoors. Keep rescue medication accessible. Consult physician."},
        ].map(g=>(
          <div key={g.group} style={{display:"flex",gap:10,padding:"7px 0",borderBottom:"1px solid var(--border)"}}>
            <div style={{width:3,background:"#dc2626",borderRadius:2,flexShrink:0,alignSelf:"stretch"}}/>
            <div>
              <div style={{fontSize:9,fontWeight:700,color:"#ef4444",marginBottom:2,letterSpacing:".07em",textTransform:"uppercase"}}>{g.group}</div>
              <div style={{fontSize:11,color:"var(--s300)",lineHeight:1.5}}>{g.advice}</div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

// â”€â”€â”€ MAP SCREEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function MapScreen(){
  const {WARDS}=useAppData();
  const[sel,setSel]=useState(null);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10,paddingBottom:72}} className="fade-up">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:14,fontWeight:700}}>Ward Pollution Map</div>
          <div style={{fontSize:9,color:"var(--s400)"}}>{WARDS.length} wards Â· City view Â· Live</div>
        </div>
        <SDot color="grn"/>
      </div>

      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
        {[["â‰¤50","#16a34a"],["51-100","#ca8a04"],["101-150","#c2410c"],["151-200","#dc2626"],["201-300","#9333ea"],["300+","#6d28d9"]].map(([l,c])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:3}}>
            <div style={{width:7,height:7,background:c,borderRadius:1}}/>
            <span style={{fontSize:8,color:"var(--s400)",letterSpacing:".06em"}}>{l}</span>
          </div>
        ))}
      </div>

      <Panel style={{padding:10,position:"relative",overflow:"hidden"}}>
        <div className="scan-line"/>
        <div className="ward-grid">
          {WARDS.map(w=>{
            const c=aqiCfg(w.aqi);
            return(
              <div key={w.id} className={`ward-cell ${sel?.id===w.id?"sel":""}`}
                style={{background:c.color,opacity:sel&&sel.id!==w.id?.6:1,minHeight:48}}
                onClick={()=>setSel(sel?.id===w.id?null:w)}>
                <div className="mono" style={{fontSize:10,fontWeight:700,color:"#fff"}}>{w.aqi}</div>
                <div style={{fontSize:8,color:"rgba(255,255,255,.72)",marginTop:1}}>W{w.id}</div>
                {w.status==="critical"&&<div className="blink" style={{position:"absolute",top:3,right:3,width:5,height:5,background:"#fff",borderRadius:"50%"}}/>}
              </div>
            );
          })}
        </div>
      </Panel>

      {sel&&(()=>{
        const c=aqiCfg(sel.aqi);
        return(
          <Panel style={{padding:14,borderColor:c.color+"40"}} className="fade-up">
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
              <div>
                <div style={{fontSize:9,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".09em"}}>Ward {sel.id} â€” {sel.sector} Zone</div>
                <div style={{fontSize:14,fontWeight:700,color:"var(--white)",marginTop:2}}>{sel.name}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div className="mono" style={{fontSize:28,fontWeight:700,color:c.color,lineHeight:1}}>{sel.aqi}</div>
                <div style={{marginTop:2}}><Badge color={c.color}>{c.label}</Badge></div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5}}>
              {[["PM2.5",sel.pm25,"Î¼g/mÂ³"],["PM10",sel.pm10,"Î¼g/mÂ³"],["NOâ‚‚",sel.no2,"ppb"],["SOâ‚‚",sel.so2,"ppb"],["Oâ‚ƒ",sel.o3,"ppb"],["CO",sel.co,"ppm"]].map(([k,v,u])=>(
                <div key={k} style={{padding:"7px 8px",background:"var(--n800)",borderRadius:2,border:"1px solid var(--border)"}}>
                  <div style={{fontSize:8,color:"var(--s400)"}}>{k}</div>
                  <div className="mono" style={{fontSize:13,fontWeight:700,color:"var(--white)",marginTop:1}}>{v}<span style={{fontSize:8,color:"var(--s400)",marginLeft:2}}>{u}</span></div>
                </div>
              ))}
            </div>
          </Panel>
        );
      })()}

      <Panel style={{padding:14}}>
        <SL>Ward AQI Ranking</SL>
        {[...WARDS].sort((a,b)=>b.aqi-a.aqi).map((w,i)=>{
          const c=aqiCfg(w.aqi);
          return(
            <div key={w.id} className="hover-row" style={{display:"flex",alignItems:"center",gap:10,padding:"6px 5px",borderBottom:"1px solid var(--border)",cursor:"pointer"}}
              onClick={()=>setSel(w)}>
              <span className="mono" style={{fontSize:9,color:"var(--s400)",width:14}}>#{i+1}</span>
              <div style={{flex:1,fontSize:10,color:i<3?"var(--white)":"var(--s300)",fontWeight:i<3?600:400}}>W{w.id} â€” {w.name}</div>
              <div className="abar" style={{width:55}}><div className="afill" style={{width:`${(w.aqi/500)*100}%`,background:c.color}}/></div>
              <span className="mono" style={{fontSize:11,fontWeight:700,color:c.color,width:30,textAlign:"right"}}>{w.aqi}</span>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

// â”€â”€â”€ TRENDS SCREEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TrendsScreen(){
  const {WEEKLY,POLLUTANTS,MY_WARD}=useAppData();
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10,paddingBottom:72}} className="fade-up">
      <div>
        <div style={{fontSize:14,fontWeight:700}}>Pollution Analytics</div>
        <div style={{fontSize:9,color:"var(--s400)"}}>Ward {MY_WARD.id} Â· 7-day historical record</div>
      </div>

      <Panel style={{padding:14}}>
        <SL>Daily AQI â€” Past 7 Days</SL>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={WEEKLY} margin={{top:4,right:4,bottom:0,left:-24}}>
            <XAxis dataKey="d" tick={{fontSize:9,fill:"#64748b",fontFamily:"IBM Plex Mono"}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:9,fill:"#64748b",fontFamily:"IBM Plex Mono"}} axisLine={false} tickLine={false}/>
            <CartesianGrid vertical={false} stroke="rgba(148,163,184,.05)"/>
            <Tooltip content={<TT/>}/>
            <ReferenceLine y={200} stroke="#9333ea" strokeDasharray="3 3" strokeWidth={1}/>
            <Bar dataKey="aqi" radius={[2,2,0,0]} name="AQI">
              {WEEKLY.map((e,i)=><Cell key={i} fill={aqiCfg(e.aqi).color} fillOpacity={.88}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel style={{padding:14}}>
        <SL>PM2.5 vs PM10 â€” 7 Days</SL>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={WEEKLY} margin={{top:4,right:4,bottom:0,left:-24}}>
            <XAxis dataKey="d" tick={{fontSize:9,fill:"#64748b",fontFamily:"IBM Plex Mono"}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:9,fill:"#64748b",fontFamily:"IBM Plex Mono"}} axisLine={false} tickLine={false}/>
            <CartesianGrid vertical={false} stroke="rgba(148,163,184,.05)"/>
            <Tooltip content={<TT/>}/>
            <Legend wrapperStyle={{fontSize:9,fontFamily:"IBM Plex Mono",color:"var(--s400)"}}/>
            <Line type="monotone" dataKey="pm25" stroke="#ef4444" strokeWidth={1.5} dot={{r:2,fill:"#ef4444"}} name="PM2.5"/>
            <Line type="monotone" dataKey="pm10" stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 2" dot={{r:2,fill:"#f97316"}} name="PM10"/>
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel style={{padding:14}}>
        <SL>7-Day Statistical Summary</SL>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:6}}>
          {[
            {label:"7-Day Mean AQI",value:"158",unit:"",color:"#f97316"},
            {label:"Peak AQI",value:"201",unit:"(Thu)",color:"#dc2626"},
            {label:"Min AQI",value:"134",unit:"(Sat)",color:"#16a34a"},
            {label:"Std Deviation",value:"23.4",unit:"pts",color:"var(--s300)"},
            {label:"Days Above 200",value:"1",unit:"/ 7 days",color:"#9333ea"},
            {label:"PM2.5 Weekly Avg",value:"66.7",unit:"Î¼g/mÂ³",color:"#ef4444"},
          ].map(s=>(
            <div key={s.label} style={{padding:"9px 10px",background:"var(--n800)",borderRadius:2,border:"1px solid var(--border)"}}>
              <div style={{fontSize:8,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".09em",marginBottom:4}}>{s.label}</div>
              <div className="mono" style={{fontSize:18,fontWeight:700,color:s.color}}>
                {s.value}<span style={{fontSize:9,color:"var(--s400)",fontWeight:400,marginLeft:3}}>{s.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel style={{padding:14}}>
        <SL>Pollutant Contribution to AQI</SL>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <PieChart width={110} height={110}>
            <Pie data={POLLUTANTS} cx={50} cy={50} innerRadius={34} outerRadius={50} dataKey="pct" strokeWidth={0}>
              {POLLUTANTS.map((p,i)=><Cell key={i} fill={p.color}/>)}
            </Pie>
          </PieChart>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:5}}>
            {POLLUTANTS.map(p=>(
              <div key={p.key} style={{display:"flex",alignItems:"center",gap:7}}>
                <div style={{width:6,height:6,background:p.color,borderRadius:1,flexShrink:0}}/>
                <span style={{fontSize:9,color:"var(--s300)",flex:1}}>{p.key}</span>
                <div className="abar" style={{width:45}}><div className="afill" style={{width:`${p.pct*2.5}%`,background:p.color}}/></div>
                <span className="mono" style={{fontSize:9,fontWeight:600,color:p.color,width:24,textAlign:"right"}}>{p.pct}%</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{marginTop:10,padding:"9px 11px",background:"var(--n800)",borderRadius:2,borderLeft:"2px solid var(--blue)"}}>
          <div style={{fontSize:10,color:"var(--s300)",lineHeight:1.5}}>
            <span style={{color:"var(--blue)"}}>Analysis: </span>
            PM2.5 (38%) and PM10 (26%) account for 64% of today's AQI. Primary sources: vehicular exhaust on NH-44 corridor and active construction on bypass road.
          </div>
        </div>
      </Panel>
    </div>
  );
}

// â”€â”€â”€ ALERTS SCREEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AlertsScreen(){
  const {ALERTS_DATA,MY_WARD}=useAppData();
  const sevColor={critical:"#7c3aed",severe:"#dc2626",high:"#f97316",moderate:"#ca8a04"};
  const sevBg={critical:"rgba(124,58,237,.1)",severe:"rgba(220,38,38,.09)",high:"rgba(194,65,12,.09)",moderate:"rgba(217,119,6,.09)"};
  const sevBdr={critical:"rgba(124,58,237,.35)",severe:"rgba(220,38,38,.3)",high:"rgba(249,115,22,.28)",moderate:"rgba(251,191,36,.28)"};
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10,paddingBottom:72}} className="fade-up">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:14,fontWeight:700}}>Alerts & Advisories</div>
          <div style={{fontSize:9,color:"var(--s400)"}}>City district Â· Live incident feed</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <SDot color="red"/>
          <span style={{fontSize:9,color:"#ef4444",fontWeight:700,letterSpacing:".1em"}}>
            {ALERTS_DATA.filter(a=>a.sev==="critical"||a.sev==="severe").length} CRITICAL
          </span>
        </div>
      </div>

      {ALERTS_DATA.map(a=>(
        <div key={a.id} style={{borderRadius:2,padding:"11px 13px",background:sevBg[a.sev],border:`1px solid ${sevBdr[a.sev]}`}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <Badge color={sevColor[a.sev]}>{a.sev}</Badge>
              <span className="mono" style={{fontSize:9,color:"var(--s400)"}}>{a.time} IST</span>
              {a.delta!=="â€”"&&<span className="mono" style={{fontSize:9,color:"#ef4444",fontWeight:700}}>{a.delta}</span>}
            </div>
          </div>
          <div style={{fontSize:9,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>{a.ward}</div>
          <div style={{fontSize:12,fontWeight:600,color:"var(--white)",marginBottom:5}}>{a.event}</div>
          <div style={{fontSize:9,color:"var(--s400)"}}>Response: <span style={{color:"var(--s200)"}}>{a.action}</span></div>
        </div>
      ))}

      <Panel style={{padding:14}}>
        <SL>Emergency Response Protocols</SL>
        {[
          {range:"AQI 0â€“100",  level:"NORMAL",    protocol:"Routine monitoring. No action required.",color:"#16a34a"},
          {range:"AQI 101â€“200",level:"ELEVATED",  protocol:"Issue public advisory. Alert municipal teams.",color:"#ca8a04"},
          {range:"AQI 201â€“300",level:"HIGH ALERT",protocol:"Vehicle restriction. Water sprinkling. School advisory.",color:"#f97316"},
          {range:"AQI 301â€“400",level:"EMERGENCY", protocol:"Industrial shutdown. Road restrictions. Hospitals on alert.",color:"#dc2626"},
          {range:"AQI 400+",   level:"DISASTER",  protocol:"Full emergency activation. District Collector notified. NDRF.",color:"#7c3aed"},
        ].map(p=>{
          const active=(MY_WARD.aqi>150&&MY_WARD.aqi<=200&&p.level==="ELEVATED");
          return(
            <div key={p.level} style={{display:"flex",gap:10,padding:"7px 9px",background:active?p.color+"18":"var(--n800)",borderRadius:2,border:`1px solid ${active?p.color+"45":"var(--border)"}`,borderLeft:`3px solid ${p.color}`,marginBottom:5}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:7,marginBottom:2,alignItems:"center"}}>
                  <span className="mono" style={{fontSize:9,color:"var(--s400)"}}>{p.range}</span>
                  <Badge color={p.color}>{p.level}</Badge>
                  {active&&<Badge color="#3b82f6">CURRENT</Badge>}
                </div>
                <div style={{fontSize:10,color:"var(--s300)"}}>{p.protocol}</div>
              </div>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

// â”€â”€â”€ OFFICER DASHBOARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function OfficerDashboard({onSwitch}){
  const {WARDS,CITY_AVG}=useAppData();
  const[tab,setTab]=useState("overview");
  const TABS=[{id:"overview",l:"Overview"},{id:"heatmap",l:"Heatmap"},{id:"wards",l:"Wards Table"},{id:"policy",l:"AI Policy"},{id:"complaints",l:"Complaints"}];
  const critWards=WARDS.filter(w=>w.aqi>300).length;
  const alertWards=WARDS.filter(w=>w.aqi>200).length;
  const totalSensors=WARDS.reduce((s,w)=>s+w.sensors,0);
  return(
    <div style={{minHeight:"100vh",background:"var(--n950)",display:"flex",flexDirection:"column"}}>
      {/* Header */}
      <div style={{borderBottom:"1px solid var(--border-md)",background:"var(--n900)"}}>
        <div style={{padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:26,height:26,background:"var(--blue)",borderRadius:2,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <svg width="12" height="12" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
              </div>
              <div>
                <div style={{fontSize:8,letterSpacing:".15em",color:"var(--blue)",fontWeight:700,textTransform:"uppercase"}}>Pollution Control Board</div>
                <div style={{fontSize:11,fontWeight:700,color:"var(--white)"}}>District Command Centre</div>
              </div>
            </div>
            <div style={{width:1,height:24,background:"var(--border-md)"}}/>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <SDot color="grn"/>
              <span style={{fontSize:8,color:"var(--green-lt)",fontWeight:700,letterSpacing:".12em"}}>ALL SYSTEMS OPERATIONAL</span>
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button className="btn-g" onClick={onSwitch} style={{fontSize:9}}>Citizen View</button>
            <div className="mono" style={{fontSize:9,color:"var(--s400)",borderLeft:"1px solid var(--border)",paddingLeft:8}}>
              {new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false})} IST
            </div>
          </div>
        </div>
        {/* KPI Strip */}
        <div style={{display:"flex",borderTop:"1px solid var(--border)",overflowX:"auto"}}>
          {[
            {label:"City Avg AQI",value:CITY_AVG,color:aqiCfg(CITY_AVG).color},
            {label:"Critical Wards",value:critWards,color:"#7c3aed"},
            {label:"On Alert",value:alertWards,color:"#dc2626"},
            {label:"Active Sensors",value:`${totalSensors}/47`,color:"#22c55e"},
            {label:"Open Actions",value:"7",color:"#f97316"},
            {label:"Complaints",value:"4",color:"var(--s300)"},
          ].map((k,i)=>(
            <div key={i} style={{flexShrink:0,padding:"7px 14px",borderRight:"1px solid var(--border)"}}>
              <div style={{fontSize:8,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em",marginBottom:2}}>{k.label}</div>
              <div className="mono" style={{fontSize:17,fontWeight:700,color:k.color}}>{k.value}</div>
            </div>
          ))}
        </div>
        {/* Tabs */}
        <div style={{display:"flex",overflowX:"auto"}}>
          {TABS.map(t=><button key={t.id} className={`tab-btn ${tab===t.id?"active":""}`} onClick={()=>setTab(t.id)}>{t.l}</button>)}
        </div>
      </div>
      {/* Content */}
      <div style={{flex:1,overflow:"auto",padding:"14px 16px",maxWidth:940,width:"100%",alignSelf:"center"}}>
        {tab==="overview"   && <OfficerOverview/>}
        {tab==="heatmap"    && <OfficerHeatmap/>}
        {tab==="wards"      && <OfficerWards/>}
        {tab==="policy"     && <OfficerPolicy/>}
        {tab==="complaints" && <OfficerComplaints/>}
      </div>
    </div>
  );
}

function OfficerOverview(){
  const {ALERTS_DATA,HOURLY,WARDS}=useAppData();
  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}} className="fade-up">
      {ALERTS_DATA.filter(a=>a.sev==="critical"||a.sev==="severe").map(a=>(
        <div key={a.id} style={{borderRadius:2,padding:"10px 13px",background:"rgba(220,38,38,.1)",border:"1px solid rgba(220,38,38,.3)",display:"flex",gap:11,alignItems:"center"}}>
          <SDot color="red"/>
          <div style={{flex:1}}>
            <div style={{display:"flex",gap:8,marginBottom:2}}>
              <Badge color="#ef4444">{a.sev}</Badge>
              <span style={{fontSize:9,color:"var(--s400)"}}>{a.time} IST</span>
              <span style={{fontSize:9,color:"var(--s300)",fontWeight:600}}>{a.ward}</span>
            </div>
            <div style={{fontSize:12,fontWeight:600,color:"var(--white)"}}>{a.event}</div>
          </div>
          <button className="btn-g" style={{flexShrink:0,fontSize:9}}>Assign Response</button>
        </div>
      ))}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Panel style={{padding:13}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em",marginBottom:9}}>City AQI â€” Last 24 Hours</div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={HOURLY} margin={{top:4,right:4,bottom:0,left:-24}}>
              <defs>
                <linearGradient id="og" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={.28}/>
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="h" tick={{fontSize:8,fill:"#64748b",fontFamily:"IBM Plex Mono"}} axisLine={false} tickLine={false} interval={4}/>
              <YAxis tick={{fontSize:8,fill:"#64748b",fontFamily:"IBM Plex Mono"}} axisLine={false} tickLine={false}/>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,.05)"/>
              <Tooltip content={<TT/>}/>
              <ReferenceLine y={200} stroke="#9333ea" strokeDasharray="2 2" strokeWidth={1}/>
              <Area type="monotone" dataKey="aqi" stroke="#3b82f6" strokeWidth={1.5} fill="url(#og)" dot={false} name="AQI"/>
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel style={{padding:13}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em",marginBottom:9}}>Wind & Pollution Movement</div>
          <div style={{display:"flex",gap:12}}>
            <div style={{flexShrink:0,position:"relative",width:80,height:80}}>
              <svg viewBox="0 0 80 80" width="80" height="80">
                <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(148,163,184,.18)" strokeWidth="1"/>
                <circle cx="40" cy="40" r="24" fill="none" stroke="rgba(148,163,184,.1)" strokeWidth="1"/>
                {[["N",40,10],["S",40,72],["W",8,43],["E",68,43]].map(([l,x,y])=>(
                  <text key={l} x={x} y={y} fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="IBM Plex Mono">{l}</text>
                ))}
                <defs><marker id="ar2" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="#3b82f6"/></marker></defs>
                <line x1="22" y1="22" x2="56" y2="56" stroke="#3b82f6" strokeWidth="1.8" markerEnd="url(#ar2)"/>
                <circle cx="40" cy="40" r="3" fill="rgba(59,130,246,.5)"/>
              </svg>
            </div>
            <div style={{flex:1,display:"flex",flexDirection:"column",gap:5,justifyContent:"center"}}>
              {[
                {l:"Direction",v:"NW â†’ SE",c:"#3b82f6"},
                {l:"Speed",v:"12 km/h",c:"var(--white)"},
                {l:"Carrying",v:"PM from W13",c:"#f97316"},
                {l:"Impact ETA",v:"W5,W6,W14 +45min",c:"#dc2626"},
              ].map(r=>(
                <div key={r.l} style={{display:"flex",gap:6}}>
                  <span style={{fontSize:9,color:"var(--s400)",width:60,flexShrink:0}}>{r.l}</span>
                  <span style={{fontSize:9,fontWeight:600,color:r.c}}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <Panel style={{padding:13}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em",marginBottom:9}}>Real-Time Spike Detector â€” High AQI Wards</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 64px 64px 64px 80px",borderBottom:"1px solid var(--border-md)",paddingBottom:5,marginBottom:4}}>
          {["Ward","AQI","1H Î”","30M Spike","Status"].map((h,i)=>(
            <div key={i} style={{fontSize:8,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".09em",padding:"0 6px"}}>{h}</div>
          ))}
        </div>
        {WARDS.filter(w=>w.aqi>150).sort((a,b)=>b.aqi-a.aqi).slice(0,6).map(w=>{
          const c=aqiCfg(w.aqi);
          const spike=(Math.floor(Math.random()*40+8));
          return(
            <div key={w.id} className="hover-row" style={{display:"grid",gridTemplateColumns:"1fr 64px 64px 64px 80px",borderBottom:"1px solid var(--border)",padding:"0"}}>
              <div style={{padding:"7px 6px",fontSize:11,color:"var(--s200)",fontWeight:500}}>W{w.id} â€” {w.name}</div>
              <div className="mono" style={{padding:"7px 6px",fontSize:12,fontWeight:700,color:c.color,display:"flex",alignItems:"center"}}>{w.aqi}</div>
              <div className="mono" style={{padding:"7px 6px",fontSize:10,color:"#ef4444",display:"flex",alignItems:"center"}}>+{Math.floor(Math.random()*20+3)}</div>
              <div className="mono" style={{padding:"7px 6px",fontSize:10,color:"#f97316",display:"flex",alignItems:"center"}}>+{spike}%</div>
              <div style={{padding:"7px 6px",display:"flex",alignItems:"center"}}><Badge color={c.color}>{w.status.toUpperCase()}</Badge></div>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

function OfficerHeatmap(){
  const {WARDS}=useAppData();
  const[sel,setSel]=useState(null);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}} className="fade-up">
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Panel style={{padding:13,position:"relative",overflow:"hidden"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em",marginBottom:10}}>Ward Pollution Heatmap Â· Live</div>
          <div style={{position:"relative"}}>
            <div className="scan-line"/>
            <div className="ward-grid" style={{gap:4}}>
              {WARDS.map(w=>{
                const c=aqiCfg(w.aqi);
                return(
                  <div key={w.id} className={`ward-cell ${sel?.id===w.id?"sel":""}`}
                    style={{background:c.color,opacity:sel&&sel.id!==w.id?.52:1,minHeight:50}}
                    onClick={()=>setSel(sel?.id===w.id?null:w)}>
                    <div className="mono" style={{fontSize:10,fontWeight:700,color:"#fff"}}>{w.aqi}</div>
                    <div style={{fontSize:8,color:"rgba(255,255,255,.72)",marginTop:1}}>W{w.id}</div>
                    {w.status==="critical"&&<div className="blink" style={{position:"absolute",top:3,right:3,width:5,height:5,background:"#fff",borderRadius:"50%"}}/>}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{marginTop:9,display:"flex",gap:4,flexWrap:"wrap"}}>
            {[["â‰¤50","#16a34a"],["51-100","#ca8a04"],["101-150","#c2410c"],["151-200","#dc2626"],["201-300","#9333ea"],["300+","#6d28d9"]].map(([l,c])=>(
              <div key={l} style={{display:"flex",alignItems:"center",gap:3}}>
                <div style={{width:7,height:7,background:c,borderRadius:1}}/>
                <span className="mono" style={{fontSize:8,color:"var(--s400)"}}>{l}</span>
              </div>
            ))}
          </div>
        </Panel>

        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {sel?(
            <Panel style={{padding:13,borderColor:aqiCfg(sel.aqi).color+"45"}} className="fade-up">
              <div style={{fontSize:9,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".09em",marginBottom:6}}>Ward {sel.id} â€” {sel.sector} Sector</div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:14,fontWeight:700,color:"var(--white)"}}>{sel.name}</div>
                <div style={{textAlign:"right"}}>
                  <div className="mono" style={{fontSize:26,fontWeight:700,color:aqiCfg(sel.aqi).color,lineHeight:1}}>{sel.aqi}</div>
                  <div style={{marginTop:2}}><Badge color={aqiCfg(sel.aqi).color}>{aqiCfg(sel.aqi).label}</Badge></div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5}}>
                {[["PM2.5",sel.pm25,"Î¼g/mÂ³"],["PM10",sel.pm10,"Î¼g/mÂ³"],["NOâ‚‚",sel.no2,"ppb"],["SOâ‚‚",sel.so2,"ppb"],["Oâ‚ƒ",sel.o3,"ppb"],["CO",sel.co,"ppm"]].map(([k,v,u])=>(
                  <div key={k} style={{padding:"6px 8px",background:"var(--n800)",borderRadius:2,border:"1px solid var(--border)"}}>
                    <div style={{fontSize:8,color:"var(--s400)"}}>{k}</div>
                    <div className="mono" style={{fontSize:12,fontWeight:700,color:"var(--white)",marginTop:1}}>{v}<span style={{fontSize:8,color:"var(--s400)",marginLeft:2}}>{u}</span></div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:8,padding:"6px 8px",background:"var(--n800)",borderRadius:2,borderLeft:"2px solid var(--blue)"}}>
                <div style={{fontSize:9,color:"var(--s300)"}}>Sensors: <span className="mono" style={{fontWeight:700}}>{sel.sensors} active</span> Â· Status: <Badge color={sel.status==="critical"?"#7c3aed":sel.status==="alert"?"#dc2626":"#16a34a"}>{sel.status}</Badge></div>
              </div>
            </Panel>
          ):(
            <Panel style={{padding:13,display:"flex",alignItems:"center",justifyContent:"center",minHeight:160}}>
              <div style={{textAlign:"center",color:"var(--s400)"}}>
                <div style={{fontSize:10,marginBottom:3,fontWeight:600}}>No ward selected</div>
                <div style={{fontSize:9}}>Click any cell on the heatmap</div>
              </div>
            </Panel>
          )}

          <Panel style={{padding:13}}>
            <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em",marginBottom:8}}>District AQI Distribution</div>
            {[
              {l:"Severe / Critical (>300)",n:WARDS.filter(w=>w.aqi>300).length,c:"#6d28d9"},
              {l:"Very Poor (201â€“300)",n:WARDS.filter(w=>w.aqi>200&&w.aqi<=300).length,c:"#9333ea"},
              {l:"Poor (151â€“200)",n:WARDS.filter(w=>w.aqi>150&&w.aqi<=200).length,c:"#dc2626"},
              {l:"Moderate (101â€“150)",n:WARDS.filter(w=>w.aqi>100&&w.aqi<=150).length,c:"#c2410c"},
              {l:"Satisfactory (â‰¤100)",n:WARDS.filter(w=>w.aqi<=100).length,c:"#16a34a"},
            ].map(s=>(
              <div key={s.l} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <span style={{fontSize:9,color:"var(--s400)",flex:1}}>{s.l}</span>
                <div className="abar" style={{width:55}}><div className="afill" style={{width:`${(s.n/15)*100}%`,background:s.c}}/></div>
                <span className="mono" style={{fontSize:11,fontWeight:700,color:s.c,width:14,textAlign:"right"}}>{s.n}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function OfficerWards(){
  const {WARDS}=useAppData();
  const[sort,setSort]=useState("aqi");
  const sorted=[...WARDS].sort((a,b)=>sort==="aqi"?b.aqi-a.aqi:sort==="pm25"?b.pm25-a.pm25:a.id-b.id);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}} className="fade-up">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em"}}>All {WARDS.length} Wards · Live Monitoring</div>
        <div style={{display:"flex",gap:4}}>
          {[["aqi","AQI"],["pm25","PM2.5"],["id","Ward No."]].map(([k,l])=>(
            <button key={k} className={sort===k?"btn-p":"btn-g"} onClick={()=>setSort(k)} style={{fontSize:9,padding:"4px 9px"}}>Sort: {l}</button>
          ))}
        </div>
      </div>
      <Panel style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"28px 1fr 60px 60px 60px 60px 60px 75px 80px",borderBottom:"1px solid var(--border-md)"}}>
          {["#","Ward","AQI","PM2.5","PM10","NOâ‚‚","SOâ‚‚","Sources","Action"].map((h,i)=>(
            <div key={i} style={{padding:"7px 8px",fontSize:8,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".09em",borderRight:i<8?"1px solid var(--border)":"none"}}>{h}</div>
          ))}
        </div>
        {sorted.map((w,i)=>{
          const c=aqiCfg(w.aqi);
          const src=w.aqi>300?"Industry":w.aqi>200?"Traffic+Indus":w.aqi>150?"Traffic+Dust":"Low Activity";
          const act=w.aqi>300?"EMERGENCY":w.aqi>200?"ALERT":w.aqi>100?"MONITOR":"NORMAL";
          const ac=act==="EMERGENCY"?"#7c3aed":act==="ALERT"?"#dc2626":act==="MONITOR"?"#f97316":"#16a34a";
          return(
            <div key={w.id} className="hover-row" style={{display:"grid",gridTemplateColumns:"28px 1fr 60px 60px 60px 60px 60px 75px 80px",borderBottom:"1px solid var(--border)"}}>
              <div style={{padding:"7px 8px",borderRight:"1px solid var(--border)",display:"flex",alignItems:"center"}}>
                <span className="mono" style={{fontSize:9,color:"var(--s400)"}}>{i+1}</span>
              </div>
              <div style={{padding:"7px 9px",borderRight:"1px solid var(--border)"}}>
                <div style={{fontSize:10,fontWeight:600,color:i<3?"var(--white)":"var(--s300)"}}>W{w.id} â€” {w.name}</div>
                <div style={{fontSize:8,color:"var(--s400)"}}>{w.sector} Â· {w.sensors} sensors</div>
              </div>
              <div className="mono" style={{padding:"7px 8px",fontSize:12,fontWeight:700,color:c.color,borderRight:"1px solid var(--border)",display:"flex",alignItems:"center"}}>{w.aqi}</div>
              {[w.pm25,w.pm10,w.no2,w.so2].map((v,j)=>(
                <div key={j} className="mono" style={{padding:"7px 8px",fontSize:10,color:"var(--s300)",borderRight:"1px solid var(--border)",display:"flex",alignItems:"center"}}>{v}</div>
              ))}
              <div style={{padding:"7px 8px",fontSize:9,color:"var(--s400)",borderRight:"1px solid var(--border)",display:"flex",alignItems:"center"}}>{src}</div>
              <div style={{padding:"7px 8px",display:"flex",alignItems:"center"}}><Badge color={ac}>{act}</Badge></div>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

function OfficerPolicy(){
  const {POLICIES}=useAppData();
  const statusCounts=POLICIES.reduce((acc,p)=>{acc[p.status]=(acc[p.status]||0)+1;return acc;},{});
  const top=POLICIES[0];
  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}} className="fade-up">
      <Panel style={{padding:13,borderColor:"rgba(59,130,246,.28)",background:"rgba(15,32,64,.7)"}}>
        <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
          <div style={{width:24,height:24,background:"var(--blue)",borderRadius:2,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
            <svg width="11" height="11" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"var(--blue)",marginBottom:3}}>AI Policy Recommendation Engine</div>
            <div style={{fontSize:10,color:"var(--s300)",lineHeight:1.6}}>
              Recommendations generated from real-time pollution data, meteorological inputs, traffic density, and historical patterns. Confidence: <span className="mono" style={{fontWeight:700}}>91.4%</span> Â· Last run: <span className="mono">10:38 IST</span>
            </div>
          </div>
        </div>
      </Panel>
      <Panel style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"44px 70px 1fr 90px 90px 82px",borderBottom:"1px solid var(--border-md)"}}>
          {["Pri","Ward","Recommended Action","Dept.","Expected","Status"].map((h,i)=>(
            <div key={i} style={{padding:"7px 10px",fontSize:8,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".09em",borderRight:i<5?"1px solid var(--border)":"none"}}>{h}</div>
          ))}
        </div>
        {POLICIES.map((p,i)=>{
          const pc=p.pri==="P1"?"#dc2626":p.pri==="P2"?"#f97316":"#ca8a04";
          const sc=p.status==="ACTIVE"?"#22c55e":p.status==="ISSUED"?"#3b82f6":p.status==="SCHEDULED"?"#ca8a04":p.status==="PENDING"?"#f97316":"#16a34a";
          return(
            <div key={i} className="hover-row" style={{display:"grid",gridTemplateColumns:"44px 70px 1fr 90px 90px 82px",borderBottom:"1px solid var(--border)"}}>
              <div style={{padding:"9px 10px",display:"flex",alignItems:"center",borderRight:"1px solid var(--border)"}}><Badge color={pc}>{p.pri}</Badge></div>
              <div style={{padding:"9px 10px",borderRight:"1px solid var(--border)",display:"flex",alignItems:"center"}}>
                <span style={{fontSize:10,color:"var(--s300)"}}>{p.ward}</span>
              </div>
              <div style={{padding:"9px 10px",borderRight:"1px solid var(--border)"}}>
                <div style={{fontSize:11,color:"var(--white)",lineHeight:1.4}}>{p.action}</div>
              </div>
              <div style={{padding:"9px 10px",borderRight:"1px solid var(--border)",display:"flex",alignItems:"center"}}>
                <span style={{fontSize:9,color:"var(--s400)"}}>{p.dept}</span>
              </div>
              <div style={{padding:"9px 10px",borderRight:"1px solid var(--border)",display:"flex",alignItems:"center"}}>
                <span className="mono" style={{fontSize:10,color:"#22c55e",fontWeight:700}}>{p.expected}</span>
              </div>
              <div style={{padding:"9px 10px",display:"flex",alignItems:"center"}}><Badge color={sc}>{p.status}</Badge></div>
            </div>
          );
        })}
      </Panel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Panel style={{padding:13}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em",marginBottom:9}}>Action Status Overview</div>
          {[["PENDING",statusCounts.PENDING||0,"#f97316"],["ACTIVE",statusCounts.ACTIVE||0,"#22c55e"],["ISSUED",statusCounts.ISSUED||0,"#3b82f6"],["SCHEDULED",statusCounts.SCHEDULED||0,"#ca8a04"],["NORMAL",statusCounts.NORMAL||0,"#16a34a"]].map(([s,n,c])=>(
            <div key={s} style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
              <Badge color={c}>{s}</Badge>
              <div className="abar" style={{flex:1}}><div className="afill" style={{width:`${(n/Math.max(POLICIES.length,1))*100}%`,background:c}}/></div>
              <span className="mono" style={{fontSize:11,fontWeight:700,color:c,width:12,textAlign:"right"}}>{n}</span>
            </div>
          ))}
        </Panel>
        <Panel style={{padding:13}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em",marginBottom:9}}>Projected Impact (P1+P2)</div>
          <div className="mono" style={{fontSize:34,fontWeight:700,color:"#22c55e",lineHeight:1,marginBottom:4}}>
            -{POLICIES.filter(p=>p.pri==="P1"||p.pri==="P2").reduce((s,p)=>s+(parseInt(String(p.expected||"").replace(/[^0-9-]/g,""),10)||0),0)}
          </div>
          <div style={{fontSize:9,color:"var(--s400)",marginBottom:10}}>AQI points if all P1+P2 actions executed</div>
          <div style={{padding:"8px 9px",background:"var(--n800)",borderRadius:2}}>
            <div style={{fontSize:9,color:"var(--s300)"}}>
              {top?.ward||"W-NA"}: <span className="mono" style={{color:"#7c3aed",fontWeight:700}}>{top?.expected?.replace("AQI ","")||"-"}</span>
              <span style={{color:"var(--s400)"}}> â†’ projected </span>
              <span className="mono" style={{color:"#16a34a",fontWeight:700}}>
                {Math.max(20,(top?.expected?.replace("AQI -","")?parseInt(top.expected.replace("AQI -",""),10):80))}
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function OfficerComplaints(){
  const {COMPLAINTS}=useAppData();
  const openCount=COMPLAINTS.filter(c=>c.status==="OPEN").length;
  const assignedCount=COMPLAINTS.filter(c=>c.status==="ASSIGNED").length;
  const resolvedCount=COMPLAINTS.filter(c=>c.status==="RESOLVED").length;
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}} className="fade-up">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em"}}>Citizen Complaint Feed Â· Live</div>
        <div style={{display:"flex",gap:7}}>
          {[["OPEN","#f97316",openCount],["ASSIGNED","#3b82f6",assignedCount],["RESOLVED","#22c55e",resolvedCount]].map(([s,c,n])=>(
            <div key={s} style={{display:"flex",alignItems:"center",gap:4}}>
              <Badge color={c}>{s}</Badge>
              <span className="mono" style={{fontSize:10,color:c}}>{n}</span>
            </div>
          ))}
        </div>
      </div>
      {COMPLAINTS.map(c=>{
        const sc=c.status==="OPEN"?"#f97316":c.status==="ASSIGNED"?"#3b82f6":"#16a34a";
        return(
          <Panel key={c.id} style={{padding:13}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
              <div style={{display:"flex",gap:7,alignItems:"center"}}>
                <Badge color={sc}>{c.status}</Badge>
                <span style={{fontSize:9,fontWeight:700,color:"var(--blue)"}}>{c.ward}</span>
                <span className="mono" style={{fontSize:8,color:"var(--s400)"}}>{c.time} IST</span>
              </div>
              <span style={{fontSize:9,color:"var(--s400)"}}>{c.votes} upvotes</span>
            </div>
            <div style={{fontSize:11,color:"var(--white)",marginBottom:9,lineHeight:1.5}}>{c.text}</div>
            <div style={{display:"flex",gap:5}}>
              {c.status!=="RESOLVED"&&<><button className="btn-p" style={{fontSize:9,padding:"5px 9px"}}>Assign Team</button><button className="btn-g" style={{fontSize:9,padding:"5px 9px"}}>Acknowledge</button></>}
              <button className="btn-g" style={{fontSize:9,padding:"5px 9px"}}>{c.status==="RESOLVED"?"View Report":"Mark Resolved"}</button>
            </div>
          </Panel>
        );
      })}
      <Panel style={{padding:13}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em",marginBottom:9}}>Complaint Statistics â€” Today</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7}}>
          {[["Total",String(COMPLAINTS.length),"var(--s200)"],["Open",String(openCount),"#f97316"],["Resolved",String(resolvedCount),"#22c55e"],["Avg. Response","18 min","#3b82f6"]].map(([l,v,c])=>(
            <div key={l} style={{padding:"9px 10px",background:"var(--n800)",borderRadius:2,border:"1px solid var(--border)",textAlign:"center"}}>
              <div style={{fontSize:8,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".09em",marginBottom:4}}>{l}</div>
              <div className="mono" style={{fontSize:18,fontWeight:700,color:c}}>{v}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// â”€â”€â”€ MAIN APP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const NAV=[
  {id:"home",l:"Overview",icon:(a)=><svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={a?2:1.5} viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>},
  {id:"map",l:"Ward Map",icon:(a)=><svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={a?2:1.5} viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>},
  {id:"trends",l:"Analytics",icon:(a)=><svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={a?2:1.5} viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>},
  {id:"alerts",l:"Alerts",icon:(a)=><svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={a?2:1.5} viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>},
];

export default function App(){
  const[mode,setMode]=useState("citizen");
  const[screen,setScreen]=useState("home");
  const[data,setData]=useState(DEFAULT_APP_DATA);
  const cfg=aqiCfg(data.MY_WARD.aqi);
  const SCREENS={home:<HomeScreen/>,map:<MapScreen/>,trends:<TrendsScreen/>,alerts:<AlertsScreen/>};

  useEffect(()=>{
    let mounted=true;
    const pull=async()=>{
      try{
        const live=await fetchBackendData();
        if(mounted)setData(prev=>({...prev,...live}));
      }catch(_err){
        // Keep rendering last known data if backend is unavailable.
      }
    };
    pull();
    const timer=setInterval(pull,60000);
    return()=>{mounted=false;clearInterval(timer);};
  },[]);

  if(mode==="officer"){
    return(
      <DataContext.Provider value={data}>
        <style>{CSS}</style>
        <OfficerDashboard onSwitch={()=>setMode("citizen")}/>
      </DataContext.Provider>
    );
  }

  return(
    <DataContext.Provider value={data}>
      <style>{CSS}</style>
      <div style={{minHeight:"100vh",background:"var(--n950)",display:"flex",justifyContent:"center"}}>
        <div style={{width:"100%",maxWidth:430,display:"flex",flexDirection:"column",minHeight:"100vh"}}>

          {/* Header */}
          <div style={{position:"sticky",top:0,zIndex:30,background:"var(--n900)",borderBottom:"1px solid var(--border-md)"}}>
            <div style={{padding:"9px 14px 7px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                <div>
                  <div style={{fontSize:8,letterSpacing:".15em",color:"var(--blue)",fontWeight:700,textTransform:"uppercase"}}>Air Quality Intelligence System</div>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--white)",lineHeight:1.2,marginTop:1}}>Ward {data.MY_WARD.id} - {data.MY_WARD.name}</div>
                  <div style={{fontSize:8,color:"var(--s400)",marginTop:1}}>Live backend integration</div>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",background:"var(--n800)",border:`1px solid ${cfg.color}38`,borderRadius:2}}>
                    <SDot color={data.MY_WARD.aqi>300?"red":"grn"}/>
                    <span className="mono" style={{fontSize:12,fontWeight:700,color:cfg.color}}>{data.MY_WARD.aqi}</span>
                    <span style={{fontSize:8,color:cfg.color,fontWeight:700,letterSpacing:".1em"}}>{cfg.label}</span>
                  </div>
                  <button className="btn-g" onClick={()=>setMode("officer")} style={{fontSize:9}}>Officer</button>
                </div>
              </div>
              <div style={{height:2,borderRadius:2,background:"linear-gradient(90deg,#16a34a 0%,#ca8a04 20%,#c2410c 40%,#dc2626 60%,#9333ea 80%,#6d28d9 100%)",position:"relative"}}>
                <div style={{position:"absolute",top:"50%",transform:"translate(-50%,-50%)",left:`${Math.min((data.MY_WARD.aqi/500)*100,97)}%`,width:8,height:8,borderRadius:"50%",background:"var(--white)",border:`2px solid ${cfg.color}`,boxShadow:`0 0 6px ${cfg.color}`}}/>
              </div>
            </div>
          </div>

          {/* Screen */}
          <div style={{flex:1,overflowY:"auto",padding:"12px 14px"}}>
            {SCREENS[screen]}
          </div>

          {/* Bottom Nav */}
          <div style={{position:"sticky",bottom:0,zIndex:30,background:"var(--n900)",borderTop:"1px solid var(--border-md)",display:"flex"}}>
            {NAV.map(item=>(
              <button key={item.id} className={`nav-item ${screen===item.id?"active":""}`} onClick={()=>setScreen(item.id)}>
                {item.icon(screen===item.id)}
                <span>{item.l}</span>
              </button>
            ))}
          </div>

        </div>
      </div>
    </DataContext.Provider>
  );
}



