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
    transition:opacity .15s,transform .08s;}
  .btn-p:hover{opacity:.82;}
  .btn-p:active{transform:translateY(1px);}
  .btn-g{background:transparent;border:1px solid var(--border-md);color:var(--s300);cursor:pointer;
    font-family:'IBM Plex Sans',sans-serif;font-size:10px;font-weight:500;letter-spacing:.05em;
    padding:5px 10px;border-radius:2px;transition:border-color .15s,color .15s,transform .08s;}
  .btn-g:hover{border-color:var(--s300);color:var(--white);}
  .btn-g:active{transform:translateY(1px);}
  .btn-p[disabled],.btn-g[disabled]{opacity:.5;cursor:not-allowed;transform:none;}
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
  if(v<=100) return{label:"SATISF.",  color:"#84cc16",dim:"#365314"};
  if(v<=150) return{label:"MODERATE", color:"#eab308",dim:"#713f12"};
  if(v<=200) return{label:"POOR",     color:"#f97316",dim:"#7c2d12"};
  if(v<=300) return{label:"V.POOR",   color:"#ef4444",dim:"#7f1d1d"};
  return           {label:"SEVERE",   color:"#7f1d1d",dim:"#450a0a"};
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
function uiAction(message){
  if(typeof window==="undefined")return;
  window.dispatchEvent(new CustomEvent("ui-action",{detail:{message}}));
}
const DEFAULT_APP_DATA={
  WARDS,MY_WARD,CITY_AVG,HOURLY,WEEKLY,POLLUTANTS,ALERTS_DATA,POLICIES,COMPLAINTS,FORECAST_3H:210,
  LOCATION:{mode:"default",label:"Default ward feed",lat:null,lon:null,cityRank:null,distanceKm:null,city:"",state:"",district:"",locality:"",wardLabel:""},
  LOCATION_RANKING:[],
  WEATHER:{temperature:null,wind_speed:null,humidity:null},
  SATELLITE:{aerosol_index:null,image_reference:""},
  PMI:0,
  AI_EXPLANATION:"AQI driven by mixed urban emissions and weather conditions.",
  LOCAL_CAUSE_HINT:"Traffic and mixed local emissions",
  DISASTER_MODE:false,
};

function useAppData(){
  return useContext(DataContext)||DEFAULT_APP_DATA;
}

function useViewport(){
  const getWidth=()=>typeof window!=="undefined"?window.innerWidth:1280;
  const [width,setWidth]=useState(getWidth);
  useEffect(()=>{
    const onResize=()=>setWidth(getWidth());
    if(typeof window!=="undefined"){
      window.addEventListener("resize",onResize);
      return()=>window.removeEventListener("resize",onResize);
    }
  },[]);
  return{
    width,
    isMobile:width<768,
    isTablet:width>=768&&width<=1024,
    isDesktop:width>1024,
  };
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

async function getJson(url, timeoutMs=12000){
  const controller=typeof AbortController!=="undefined"?new AbortController():null;
  const timeoutId=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  const res=await fetch(url, controller?{signal:controller.signal}:undefined);
  if(timeoutId)clearTimeout(timeoutId);
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function safeGetJson(url, fallback){
  try{
    return await getJson(url);
  }catch(_err){
    return fallback;
  }
}

async function fetchBackendData(location=null){
  const queryLat=location&&Number.isFinite(location.lat)?location.lat:28.6139;
  const queryLon=location&&Number.isFinite(location.lon)?location.lon:77.2090;
  const envUnified=await getJson(`${API_BASE}/environment/unified?lat=${queryLat}&lon=${queryLon}&refresh=true`, 12000)
    .catch(async()=>{
      return await getJson(`${API_BASE}/environment/unified?lat=${queryLat}&lon=${queryLon}&refresh=false`, 5000)
        .catch(()=>({data:{}}));
    });
  const envLoc=envUnified?.data?.location||{};
  const envCity=String(envLoc?.city||"");
  const envState=String(envLoc?.state||"");
  const cityId=String(envCity||"DELHI").toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"")||"DELHI";

  let effectiveCityId=cityId;
  let mapRes=await getJson(`${API_BASE}/ward-map-data?city_id=${encodeURIComponent(cityId)}&lat=${queryLat}&lon=${queryLon}`);
  let rows=Array.isArray(mapRes?.data)?mapRes.data:[];
  if(!rows.length&&cityId!=="DELHI"){
    effectiveCityId="DELHI";
    mapRes=await getJson(`${API_BASE}/ward-map-data?city_id=DELHI&lat=${queryLat}&lon=${queryLon}`).catch(()=>({data:[]}));
    rows=Array.isArray(mapRes?.data)?mapRes.data:[];
  }
  if(!rows.length)return DEFAULT_APP_DATA;

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

  let locationInfo={mode:"default",label:"Default ward feed",lat:null,lon:null,cityRank:null,distanceKm:null,city:envCity,state:envState,district:String(envLoc?.district||""),locality:String(envLoc?.locality||""),wardLabel:String(envLoc?.ward||"")};
  let locationRanking=[];
  let selectedWardId=wards[0].ward_id;

  if(location&&Number.isFinite(location.lat)&&Number.isFinite(location.lon)){
    try{
      const locRes=await getJson(`${API_BASE}/location-insights?lat=${location.lat}&lon=${location.lon}&city_id=${encodeURIComponent(effectiveCityId)}&top_n=8`);
      const nearest=locRes?.nearest_ward;
      if(nearest?.ward_id){
        selectedWardId=nearest.ward_id;
        locationInfo={
          mode:"geolocation",
          label:"Current device location",
          lat:Number(location.lat),
          lon:Number(location.lon),
          cityRank:nearest.city_rank||null,
          distanceKm:nearest.distance_km??null,
          city:envCity,
          state:envState,
          district:String(envLoc?.district||""),
          locality:String(envLoc?.locality||""),
          wardLabel:String(envLoc?.ward||""),
        };
      }
      locationRanking=Array.isArray(locRes?.ranking)?locRes.ranking:[];
    }catch(_err){
      // keep default ward selection if geolocation lookup fails
    }
  }

  const myWard=wards.find(w=>w.ward_id===selectedWardId)||wards[0];
  const cityAvg=Math.round(wards.reduce((s,w)=>s+w.aqi,0)/Math.max(wards.length,1));

  const [aqiRes,forecast3h,breakdown,alertRes,trendsRes,alertsFeed,recoRes,complaintsRes]=await Promise.all([
    safeGetJson(`${API_BASE}/ward-aqi?ward_id=${myWard.ward_id}`, null),
    safeGetJson(`${API_BASE}/aqi-forecast?ward_id=${myWard.ward_id}&horizon=3`, null),
    safeGetJson(`${API_BASE}/pollutant-breakdown?ward_id=${myWard.ward_id}`, null),
    safeGetJson(`${API_BASE}/alerts?ward_id=${myWard.ward_id}`, null),
    safeGetJson(`${API_BASE}/analytics/trends?ward_id=${myWard.ward_id}`, null),
    safeGetJson(`${API_BASE}/alerts/feed?city_id=${encodeURIComponent(cityId)}&limit=12`, {data:[]}),
    safeGetJson(`${API_BASE}/gov/recommendations?city_id=${encodeURIComponent(cityId)}`, {data:[]}),
    safeGetJson(`${API_BASE}/complaints?city_id=${encodeURIComponent(cityId)}`, {data:[]}),
  ]);

  const raw=breakdown?.data?.raw_concentration||{};
  const contrib=breakdown?.data?.contribution_percent||{};
  let mergedWard={
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
  if(locationInfo.mode==="geolocation"&&cityId!=="DELHI"){
    mergedWard={
      ...mergedWard,
      name:(locationInfo.locality||locationInfo.city||"Your Location"),
    };
  }

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
    id:"primary-1",
    sev:sevFromLevel(alertRes.data.level),
    ward:`Ward ${mergedWard.id} - ${mergedWard.name}`,
    event:alertRes.data.reason||"Crisis condition detected",
    time:toIstTime(alertRes.data.started_at_utc),
    delta:"-",
    action:alertRes.data.health_advisory||"Avoid outdoor activity",
  }]:[];

  const feedAlerts=(alertsFeed?.data||[]).map((a,idx)=>({
    id:`feed-${a.id??idx}`,
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

  const weather=envUnified?.data?.weather||{};
  const satellite=envUnified?.data?.satellite||{};
  locationInfo={
    ...locationInfo,
    city:String(envLoc?.city||locationInfo.city||""),
    state:String(envLoc?.state||locationInfo.state||""),
    district:String(envLoc?.district||locationInfo.district||""),
    locality:String(envLoc?.locality||locationInfo.locality||""),
    wardLabel:String(envLoc?.ward||locationInfo.wardLabel||""),
  };
  const forecastVal=Number(forecast3h?.data?.aqi_pred||210);
  const currentAqi=Number(aqiRes?.data?.aqi??myWard.aqi);
  const pmi=Math.max(-100,Math.min(100,Math.round(((forecastVal-currentAqi)/Math.max(currentAqi,1))*100)));
  const windTxt=weather?.wind_speed!=null?`${weather.wind_speed} km/h wind`:"stable wind";
  const humidityTxt=weather?.humidity!=null?`${weather.humidity}% humidity`:"normal humidity";
  const primary=aqiRes?.data?.primary_pollutant||"PM2.5";
  const localCauseHint=primary==="PM2.5"?"Road dust, diesel traffic, and construction emissions":
    primary==="NO2"?"Traffic corridor congestion and combustion sources":
    "Mixed local combustion and particulate sources";
  const aiExplanation=`${primary} is the dominant pollutant. ${windTxt} with ${humidityTxt} is influencing dispersion and near-term buildup across nearby wards.`;
  const disasterMode=Boolean(alertRes?.data?.active&&String(alertRes?.data?.level||"").toUpperCase()==="SEVERE")||currentAqi>300;
  if(locationInfo.mode==="geolocation"&&(!locationInfo.wardLabel||locationInfo.wardLabel==="Unknown ward")){
    locationInfo.wardLabel=`Ward ${mergedWard.id} - ${mergedWard.name}`;
  }

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
    LOCATION:locationInfo,
    LOCATION_RANKING:locationRanking,
    WEATHER:{
      temperature:weather?.temperature??null,
      wind_speed:weather?.wind_speed??null,
      humidity:weather?.humidity??null,
    },
    SATELLITE:{
      aerosol_index:satellite?.aerosol_index??null,
      image_reference:satellite?.image_reference||"",
    },
    PMI:pmi,
    AI_EXPLANATION:aiExplanation,
    LOCAL_CAUSE_HINT:localCauseHint,
    DISASTER_MODE:disasterMode,
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
  const {MY_WARD,POLLUTANTS,HOURLY,CITY_AVG,WARDS,FORECAST_3H,LOCATION,LOCATION_RANKING,PMI,AI_EXPLANATION,LOCAL_CAUSE_HINT,WEATHER,SATELLITE,DISASTER_MODE}=useAppData();
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
          <div style={{fontSize:9,color:"var(--s400)",marginTop:1}}>
            {LOCATION?.mode==="geolocation"?"Live geolocation-matched ward":"Live backend ward feed"} - {MY_WARD.ward_id||`W${MY_WARD.id}`}
          </div>
          {LOCATION?.mode==="geolocation"&&(
            <div style={{fontSize:9,color:"var(--s400)",marginTop:2}}>
              Rank #{LOCATION.cityRank||"-"} in city AQI severity {LOCATION.distanceKm!=null?`· nearest centroid ${LOCATION.distanceKm} km`:""}
            </div>
          )}
          {LOCATION?.mode==="geolocation"&&(
            <div style={{fontSize:9,color:"var(--s400)",marginTop:2}}>
              {(LOCATION.wardLabel||"")?`${LOCATION.wardLabel} · `:""}{[LOCATION.locality,LOCATION.district,LOCATION.state,LOCATION.city].filter(Boolean).join(", ")}
            </div>
          )}
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

      {!!LOCATION_RANKING?.length&&(
        <Panel style={{padding:14}}>
          <SL>Ward Ranking Near You</SL>
          {LOCATION_RANKING.slice(0,5).map((w,i)=>{
            const c=aqiCfg(w.aqi||0);
            return(
              <div key={`${w.ward_id}-${i}`} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span className="mono" style={{fontSize:10,color:"var(--s400)"}}>#{i+1}</span>
                  <span style={{fontSize:10,color:"var(--s200)"}}>{w.ward_name||w.ward_id}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span className="mono" style={{fontSize:10,color:c.color,fontWeight:700}}>{w.aqi}</span>
                  <Badge color={c.color}>{c.label}</Badge>
                </div>
              </div>
            );
          })}
        </Panel>
      )}

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
          <div style={{height:3,borderRadius:2,background:"linear-gradient(90deg,#16a34a 0%,#84cc16 20%,#eab308 40%,#f97316 60%,#ef4444 80%,#7f1d1d 100%)",position:"relative",marginBottom:5}}>
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
            <ReferenceLine y={200} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1}/>
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

      <Panel style={{padding:14}}>
        <SL>Pollution Momentum Index</SL>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div className="mono" style={{fontSize:30,fontWeight:700,color:PMI>=0?"#ef4444":"#22c55e"}}>{PMI>=0?`+${PMI}`:PMI}</div>
          <Badge color={PMI>=0?"#ef4444":"#22c55e"}>{PMI>=0?"RISING":"IMPROVING"}</Badge>
        </div>
        <div style={{fontSize:10,color:"var(--s400)",marginTop:6}}>
          Weather {WEATHER.temperature!=null?`${WEATHER.temperature}C`:"-"} · Wind {WEATHER.wind_speed!=null?`${WEATHER.wind_speed} km/h`:"-"} · Humidity {WEATHER.humidity!=null?`${WEATHER.humidity}%`:"-"}
        </div>
      </Panel>

      <Panel style={{padding:14}}>
        <SL>AI Explanation</SL>
        <div style={{fontSize:11,color:"var(--s300)",lineHeight:1.6}}>{AI_EXPLANATION}</div>
        <div style={{fontSize:10,color:"var(--s400)",marginTop:8}}>Likely local cause: {LOCAL_CAUSE_HINT}</div>
        <div style={{fontSize:10,color:"var(--s400)",marginTop:4}}>
          Satellite aerosol indicator: {SATELLITE.aerosol_index!=null?Number(SATELLITE.aerosol_index).toFixed(2):"Unavailable"}
        </div>
      </Panel>

      {DISASTER_MODE&&(
        <Panel style={{padding:14,borderColor:"rgba(124,58,237,.45)",background:"rgba(46,16,101,.25)"}}>
          <SL>Disaster Mode</SL>
          <div style={{fontSize:12,color:"#e9d5ff",fontWeight:700,marginBottom:4}}>High-risk pollution event active</div>
          <div style={{fontSize:10,color:"var(--s300)"}}>Follow district emergency advisories. Outdoor movement should be minimized.</div>
        </Panel>
      )}
    </div>
  );
}

function DesktopCitizenDashboard(){
  const {WARDS,MY_WARD,POLLUTANTS,FORECAST_3H,CITY_AVG,PMI,AI_EXPLANATION,LOCAL_CAUSE_HINT,WEATHER,SATELLITE,DISASTER_MODE}=useAppData();
  const cfg=aqiCfg(MY_WARD.aqi);
  const rank=[...WARDS].sort((a,b)=>b.aqi-a.aqi);
  const best=rank[rank.length-1]||MY_WARD;
  const worst=rank[0]||MY_WARD;
  const forecastSeries=[
    {t:"Now",aqi:MY_WARD.aqi},
    {t:"+1h",aqi:Math.max(0,Math.min(500,Math.round((MY_WARD.aqi*2+FORECAST_3H)/3)))},
    {t:"+2h",aqi:Math.max(0,Math.min(500,Math.round((MY_WARD.aqi+FORECAST_3H)/2)))},
    {t:"+3h",aqi:FORECAST_3H},
  ];
  return(
    <div className="fade-up" style={{display:"grid",gridTemplateColumns:"repeat(12,minmax(0,1fr))",gap:12,paddingBottom:16}}>
      <Panel style={{padding:14,gridColumn:"span 6"}}>
        <SL>AQI Card</SL>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:12,color:"var(--s300)"}}>Ward {MY_WARD.id} - {MY_WARD.name}</div>
            <div className="mono" style={{fontSize:66,fontWeight:700,color:cfg.color,lineHeight:1}}>{MY_WARD.aqi}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <Badge color={cfg.color}>{cfg.label}</Badge>
            <div style={{fontSize:10,color:"var(--s400)",marginTop:8}}>City Avg: {CITY_AVG}</div>
            {DISASTER_MODE&&<div style={{fontSize:10,color:"#c4b5fd",marginTop:4}}>Disaster Mode: ON</div>}
          </div>
        </div>
      </Panel>
      <Panel style={{padding:14,gridColumn:"span 6"}}>
        <SL>Pollution Map</SL>
        <div className="ward-grid" style={{gap:4}}>
          {WARDS.slice(0,25).map((w)=>(
            <div key={w.id} className="ward-cell" style={{minHeight:46,background:aqiCfg(w.aqi).color,opacity:w.ward_id===MY_WARD.ward_id?1:0.75}}>
              <div className="mono" style={{fontSize:9,fontWeight:700,color:"#fff"}}>{w.aqi}</div>
              <div style={{fontSize:8,color:"rgba(255,255,255,.8)"}}>W{w.id}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel style={{padding:14,gridColumn:"span 6"}}>
        <SL>Pollutant Contribution</SL>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={POLLUTANTS}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.12)"/>
            <XAxis dataKey="key" tick={{fontSize:10,fill:"#94a3b8"}}/>
            <YAxis tick={{fontSize:10,fill:"#94a3b8"}}/>
            <Tooltip content={<TT/>}/>
            <Bar dataKey="pct" name="Contribution %">{POLLUTANTS.map((p,i)=><Cell key={i} fill={p.color}/>)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel style={{padding:14,gridColumn:"span 6"}}>
        <SL>AQI Forecast (1-3h)</SL>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={forecastSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.12)"/>
            <XAxis dataKey="t" tick={{fontSize:10,fill:"#94a3b8"}}/>
            <YAxis tick={{fontSize:10,fill:"#94a3b8"}}/>
            <Tooltip content={<TT/>}/>
            <Line type="monotone" dataKey="aqi" stroke="#3b82f6" strokeWidth={2} dot={{r:3}}/>
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel style={{padding:14,gridColumn:"span 6"}}>
        <SL>AI Explanation</SL>
        <div style={{fontSize:12,color:"var(--s300)",lineHeight:1.7}}>{AI_EXPLANATION}</div>
      </Panel>
      <Panel style={{padding:14,gridColumn:"span 6"}}>
        <SL>Smart Safety Card</SL>
        <div style={{fontSize:11,color:"var(--s300)",marginBottom:8}}>Local cause hint: {LOCAL_CAUSE_HINT}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
          <div style={{padding:"8px 10px",background:"var(--n800)",border:"1px solid var(--border)",borderRadius:2}}><div style={{fontSize:9,color:"var(--s400)"}}>Temp</div><div className="mono" style={{fontSize:16,fontWeight:700}}>{WEATHER.temperature??"-"}</div></div>
          <div style={{padding:"8px 10px",background:"var(--n800)",border:"1px solid var(--border)",borderRadius:2}}><div style={{fontSize:9,color:"var(--s400)"}}>Wind</div><div className="mono" style={{fontSize:16,fontWeight:700}}>{WEATHER.wind_speed??"-"}</div></div>
          <div style={{padding:"8px 10px",background:"var(--n800)",border:"1px solid var(--border)",borderRadius:2}}><div style={{fontSize:9,color:"var(--s400)"}}>Humidity</div><div className="mono" style={{fontSize:16,fontWeight:700}}>{WEATHER.humidity??"-"}</div></div>
        </div>
      </Panel>

      <Panel style={{padding:14,gridColumn:"span 6"}}>
        <SL>Ward Comparison</SL>
        {[{l:"Current",w:MY_WARD},{l:"Best",w:best},{l:"Worst",w:worst}].map((r)=>(
          <div key={r.l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid var(--border)"}}>
            <span style={{fontSize:11,color:"var(--s300)"}}>{r.l} - {r.w.name}</span>
            <span className="mono" style={{fontSize:12,fontWeight:700,color:aqiCfg(r.w.aqi).color}}>{r.w.aqi}</span>
          </div>
        ))}
      </Panel>
      <Panel style={{padding:14,gridColumn:"span 6"}}>
        <SL>Pollution Momentum Index</SL>
        <div className="mono" style={{fontSize:52,fontWeight:700,color:PMI>=0?"#ef4444":"#22c55e",lineHeight:1}}>{PMI>=0?`+${PMI}`:PMI}</div>
        <div style={{fontSize:10,color:"var(--s400)",marginTop:7}}>Satellite aerosol: {SATELLITE.aerosol_index!=null?Number(SATELLITE.aerosol_index).toFixed(2):"N/A"}</div>
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
        {[["â‰¤50","#16a34a"],["51-100","#84cc16"],["101-150","#eab308"],["151-200","#f97316"],["201-300","#ef4444"],["300+","#7f1d1d"]].map(([l,c])=>(
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
            <ReferenceLine y={200} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1}/>
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
            {label:"Days Above 200",value:"1",unit:"/ 7 days",color:"#ef4444"},
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

      {ALERTS_DATA.map((a,idx)=>(
        <div key={`${a.id}-${idx}`} style={{borderRadius:2,padding:"11px 13px",background:sevBg[a.sev],border:`1px solid ${sevBdr[a.sev]}`}}>
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
  const TABS=[{id:"overview",l:"Overview"},{id:"heatmap",l:"Heatmap"},{id:"wards",l:"Wards Table"},{id:"sensors",l:"Sensors"},{id:"policy",l:"AI Policy"},{id:"complaints",l:"Complaints"}];
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
        {tab==="sensors"    && <OfficerSensors/>}
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
      {ALERTS_DATA.filter(a=>a.sev==="critical"||a.sev==="severe").map((a,idx)=>(
        <div key={`${a.id}-${idx}`} style={{borderRadius:2,padding:"10px 13px",background:"rgba(220,38,38,.1)",border:"1px solid rgba(220,38,38,.3)",display:"flex",gap:11,alignItems:"center"}}>
          <SDot color="red"/>
          <div style={{flex:1}}>
            <div style={{display:"flex",gap:8,marginBottom:2}}>
              <Badge color="#ef4444">{a.sev}</Badge>
              <span style={{fontSize:9,color:"var(--s400)"}}>{a.time} IST</span>
              <span style={{fontSize:9,color:"var(--s300)",fontWeight:600}}>{a.ward}</span>
            </div>
            <div style={{fontSize:12,fontWeight:600,color:"var(--white)"}}>{a.event}</div>
          </div>
          <button className="btn-g" onClick={()=>uiAction(`Response team assigned for ${a.ward}`)} style={{flexShrink:0,fontSize:9}}>Assign Response</button>
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
              <ReferenceLine y={200} stroke="#ef4444" strokeDasharray="2 2" strokeWidth={1}/>
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
            {[["â‰¤50","#16a34a"],["51-100","#84cc16"],["101-150","#eab308"],["151-200","#f97316"],["201-300","#ef4444"],["300+","#7f1d1d"]].map(([l,c])=>(
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
              {l:"Severe / Critical (>300)",n:WARDS.filter(w=>w.aqi>300).length,c:"#7f1d1d"},
              {l:"Very Poor (201â€“300)",n:WARDS.filter(w=>w.aqi>200&&w.aqi<=300).length,c:"#ef4444"},
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

function OfficerSensors(){
  const {WARDS}=useAppData();
  const rows=[...WARDS].sort((a,b)=>b.sensors-a.sensors);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}} className="fade-up">
      <Panel style={{padding:13}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".11em",marginBottom:8}}>Sensor Monitoring Panel</div>
        <div style={{fontSize:11,color:"var(--s300)"}}>Tracks ward-level active sensor coverage and operational health.</div>
      </Panel>
      <Panel style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"40px 1fr 120px 120px",borderBottom:"1px solid var(--border-md)"}}>
          {["#","Ward","Sensors Online","Status"].map((h,i)=><div key={i} style={{padding:"8px 10px",fontSize:8,fontWeight:700,color:"var(--s400)",textTransform:"uppercase",letterSpacing:".09em",borderRight:i<3?"1px solid var(--border)":"none"}}>{h}</div>)}
        </div>
        {rows.map((w,i)=>{
          const health=w.sensors>=5?"HEALTHY":w.sensors>=3?"STABLE":"LOW";
          const col=health==="HEALTHY"?"#22c55e":health==="STABLE"?"#3b82f6":"#f97316";
          return(
            <div key={w.id} className="hover-row" style={{display:"grid",gridTemplateColumns:"40px 1fr 120px 120px",borderBottom:"1px solid var(--border)"}}>
              <div className="mono" style={{padding:"8px 10px",fontSize:10,color:"var(--s400)",borderRight:"1px solid var(--border)"}}>{i+1}</div>
              <div style={{padding:"8px 10px",fontSize:11,color:"var(--s200)",borderRight:"1px solid var(--border)"}}>W{w.id} - {w.name}</div>
              <div className="mono" style={{padding:"8px 10px",fontSize:12,fontWeight:700,color:col,borderRight:"1px solid var(--border)"}}>{w.sensors}</div>
              <div style={{padding:"8px 10px"}}><Badge color={col}>{health}</Badge></div>
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
              {c.status!=="RESOLVED"&&<><button className="btn-p" onClick={()=>uiAction(`Team assigned to ${c.ward}`)} style={{fontSize:9,padding:"5px 9px"}}>Assign Team</button><button className="btn-g" onClick={()=>uiAction(`Complaint acknowledged for ${c.ward}`)} style={{fontSize:9,padding:"5px 9px"}}>Acknowledge</button></>}
              <button className="btn-g" onClick={()=>uiAction(c.status==="RESOLVED"?`Viewing report for ${c.ward}`:`Marked resolved for ${c.ward}`)} style={{fontSize:9,padding:"5px 9px"}}>{c.status==="RESOLVED"?"View Report":"Mark Resolved"}</button>
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
  const[data,setData]=useState(null);
  const[bootError,setBootError]=useState("");
  const[bootstrapping,setBootstrapping]=useState(true);
  const[actionToast,setActionToast]=useState("");
  const[geo,setGeo]=useState(null);
  const {isTablet,isDesktop}=useViewport();
  const safeData=data||DEFAULT_APP_DATA;
  const cfg=aqiCfg(safeData.MY_WARD.aqi);
  const SCREENS={home:isDesktop?<DesktopCitizenDashboard/>:<HomeScreen/>,map:<MapScreen/>,trends:<TrendsScreen/>,alerts:<AlertsScreen/>};
  const pullData=async()=>{
    const live=await fetchBackendData(geo);
    setData(prev=>prev?({...prev,...live}):({...DEFAULT_APP_DATA,...live}));
    setBootError("");
    setBootstrapping(false);
  };
  const requestGeo=()=>{
    if(typeof navigator==="undefined"||!navigator.geolocation)return;
    navigator.geolocation.getCurrentPosition(
      (pos)=>setGeo({lat:pos.coords.latitude,lon:pos.coords.longitude}),
      ()=>{},
      {enableHighAccuracy:true,timeout:8000,maximumAge:15000}
    );
  };

  useEffect(()=>{
    let cancelled=false;
    const resolveGeo=()=>{
      if(typeof navigator==="undefined"||!navigator.geolocation)return;
      navigator.geolocation.getCurrentPosition(
        (pos)=>{
          if(cancelled)return;
          setGeo({lat:pos.coords.latitude,lon:pos.coords.longitude});
        },
        ()=>{},
        {enableHighAccuracy:true,timeout:8000,maximumAge:60000}
      );
    };
    resolveGeo();
    return()=>{cancelled=true;};
  },[]);

  useEffect(()=>{
    let mounted=true;
    const pull=async()=>{
      try{
        if(mounted)await pullData();
      }catch(_err){
        if(mounted){
          setBootstrapping(false);
          if(!data)setBootError("Live backend is unavailable. Start backend and retry.");
        }
      }
    };
    pull();
    const timer=setInterval(pull,60000);
    return()=>{mounted=false;clearInterval(timer);};
  },[geo]);

  useEffect(()=>{
    if(typeof window==="undefined")return;
    const onUiAction=(evt)=>{
      const msg=String(evt?.detail?.message||"Action completed");
      setActionToast(msg);
      window.clearTimeout(window.__aqiToastTimer);
      window.__aqiToastTimer=window.setTimeout(()=>setActionToast(""),1800);
    };
    window.addEventListener("ui-action",onUiAction);
    return()=>window.removeEventListener("ui-action",onUiAction);
  },[]);

  if(bootstrapping&&!data){
    return(
      <DataContext.Provider value={safeData}>
        <style>{CSS}</style>
        <div style={{minHeight:"100vh",background:"var(--n950)",display:"grid",placeItems:"center",padding:20}}>
          <Panel style={{padding:"18px 20px",maxWidth:440,width:"100%"}}>
            <div style={{fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"var(--blue)",fontWeight:700,marginBottom:8}}>
              Hyperlocal Pollution Intelligence
            </div>
            <div style={{fontSize:16,fontWeight:700,color:"var(--white)",marginBottom:6}}>Fetching live data</div>
            <div style={{fontSize:12,color:"var(--s400)",marginBottom:12}}>Loading CPCB, weather, location, and ward intelligence.</div>
            <div className="abar"><div className="afill" style={{width:"65%",background:"var(--blue)"}}/></div>
          </Panel>
        </div>
      </DataContext.Provider>
    );
  }

  if(bootError&&!data){
    return(
      <DataContext.Provider value={safeData}>
        <style>{CSS}</style>
        <div style={{minHeight:"100vh",background:"var(--n950)",display:"grid",placeItems:"center",padding:20}}>
          <Panel style={{padding:"18px 20px",maxWidth:480,width:"100%"}}>
            <div style={{fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"#f97316",fontWeight:700,marginBottom:8}}>
              Backend Connection Required
            </div>
            <div style={{fontSize:15,fontWeight:700,color:"var(--white)",marginBottom:6}}>Live data could not be loaded</div>
            <div style={{fontSize:12,color:"var(--s400)",marginBottom:12}}>{bootError}</div>
            <button className="btn-p" onClick={()=>{setBootstrapping(true);setBootError("");pullData().catch(()=>{setBootstrapping(false);setBootError("Live backend is unavailable. Start backend and retry.");});}}>
              Retry Live Fetch
            </button>
          </Panel>
        </div>
      </DataContext.Provider>
    );
  }

  if(mode==="officer"){
    return(
      <DataContext.Provider value={safeData}>
        <style>{CSS}</style>
        <OfficerDashboard onSwitch={()=>setMode("citizen")}/>
        {actionToast&&(
          <div style={{position:"fixed",right:14,bottom:14,zIndex:90,padding:"8px 10px",borderRadius:3,background:"var(--n800)",border:"1px solid var(--border-md)",fontSize:11,color:"var(--s200)"}}>
            {actionToast}
          </div>
        )}
      </DataContext.Provider>
    );
  }

  return(
    <DataContext.Provider value={safeData}>
      <style>{CSS}</style>
      <div style={{minHeight:"100vh",background:"var(--n950)",display:"flex",justifyContent:"center"}}>
        <div style={{width:"100%",maxWidth:isDesktop?"100%":isTablet?980:430,display:"flex",flexDirection:isDesktop?"row":"column",minHeight:"100vh"}}>

          {isDesktop&&(
            <aside style={{width:240,borderRight:"1px solid var(--border-md)",background:"var(--n900)",padding:"14px 10px",position:"sticky",top:0,height:"100vh"}}>
              <div style={{padding:"4px 8px 12px"}}>
                <div style={{fontSize:10,letterSpacing:".15em",color:"var(--blue)",fontWeight:700,textTransform:"uppercase"}}>Citizen Panel</div>
                <div style={{fontSize:15,fontWeight:700,color:"var(--white)",marginTop:4}}>Hyperlocal AQI</div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {NAV.map(item=>(
                  <button key={item.id} className={`nav-item ${screen===item.id?"active":""}`} onClick={()=>setScreen(item.id)} style={{flex:"unset",flexDirection:"row",justifyContent:"flex-start",gap:8,padding:"10px 9px",borderTop:"none",borderRadius:3}}>
                    {item.icon(screen===item.id)}
                    <span>{item.l}</span>
                  </button>
                ))}
              </div>
              <div style={{marginTop:14,padding:"8px",border:"1px solid var(--border)",borderRadius:3,background:"var(--n800)"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                  <SDot color={safeData.MY_WARD.aqi>300?"red":"grn"}/>
                  <span className="mono" style={{fontSize:11,fontWeight:700,color:cfg.color}}>{safeData.MY_WARD.aqi}</span>
                  <Badge color={cfg.color}>{cfg.label}</Badge>
                </div>
                <button className="btn-g" onClick={requestGeo} style={{fontSize:9,width:"100%",marginBottom:6}}>Use My Location</button>
                <button className="btn-g" onClick={()=>setMode("officer")} style={{fontSize:9,width:"100%"}}>Officer Mode</button>
              </div>
            </aside>
          )}

          <div style={{width:"100%",display:"flex",flexDirection:"column",minHeight:"100vh"}}>

          {/* Header */}
          <div style={{position:"sticky",top:0,zIndex:30,background:"var(--n900)",borderBottom:"1px solid var(--border-md)"}}>
            <div style={{padding:"9px 14px 7px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                <div>
                  <div style={{fontSize:8,letterSpacing:".15em",color:"var(--blue)",fontWeight:700,textTransform:"uppercase"}}>Air Quality Intelligence System</div>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--white)",lineHeight:1.2,marginTop:1}}>Ward {safeData.MY_WARD.id} - {safeData.MY_WARD.name}</div>
                  <div style={{fontSize:8,color:"var(--s400)",marginTop:1}}>Live backend integration</div>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",background:"var(--n800)",border:`1px solid ${cfg.color}38`,borderRadius:2}}>
                    <SDot color={safeData.MY_WARD.aqi>300?"red":"grn"}/>
                    <span className="mono" style={{fontSize:12,fontWeight:700,color:cfg.color}}>{safeData.MY_WARD.aqi}</span>
                    <span style={{fontSize:8,color:cfg.color,fontWeight:700,letterSpacing:".1em"}}>{cfg.label}</span>
                  </div>
                  {!isDesktop&&<button className="btn-g" onClick={requestGeo} style={{fontSize:9}}>Use My Location</button>}
                  <button className="btn-g" onClick={()=>setMode("officer")} style={{fontSize:9}}>Officer</button>
                </div>
              </div>
              <div style={{height:2,borderRadius:2,background:"linear-gradient(90deg,#16a34a 0%,#84cc16 20%,#eab308 40%,#f97316 60%,#ef4444 80%,#7f1d1d 100%)",position:"relative"}}>
                <div style={{position:"absolute",top:"50%",transform:"translate(-50%,-50%)",left:`${Math.min((safeData.MY_WARD.aqi/500)*100,97)}%`,width:8,height:8,borderRadius:"50%",background:"var(--white)",border:`2px solid ${cfg.color}`,boxShadow:`0 0 6px ${cfg.color}`}}/>
              </div>
            </div>
          </div>

          {/* Screen */}
          <div style={{flex:1,overflowY:"auto",padding:isDesktop?"14px 16px":"12px 14px"}}>
            {SCREENS[screen]}
          </div>

          {/* Bottom Nav */}
          {!isDesktop&&<div style={{position:"sticky",bottom:0,zIndex:30,background:"var(--n900)",borderTop:"1px solid var(--border-md)",display:"flex"}}>
            {NAV.map(item=>(
              <button key={item.id} className={`nav-item ${screen===item.id?"active":""}`} onClick={()=>setScreen(item.id)}>
                {item.icon(screen===item.id)}
                <span>{item.l}</span>
              </button>
            ))}
          </div>}

          </div>
        </div>
      </div>
      {actionToast&&(
        <div style={{position:"fixed",right:14,bottom:isDesktop?14:62,zIndex:90,padding:"8px 10px",borderRadius:3,background:"var(--n800)",border:"1px solid var(--border-md)",fontSize:11,color:"var(--s200)"}}>
          {actionToast}
        </div>
      )}
    </DataContext.Provider>
  );
}



