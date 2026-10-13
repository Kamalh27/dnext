import type { Lang } from "./types";

export type LegalKind = "privacy" | "cookies" | "terms" | "disclaimer";
export interface Section { h: string; p?: string[]; ul?: string[] }
export interface LegalDoc { title: string; sections: Section[] }

export const LEGAL_UPDATED = "13 October 2026";

/**
 * Plain-language drafts that describe what this app actually does today. Have counsel review before public launch,
 * and update them whenever data handling changes (e.g. analytics, accounts, new processors).
 */
export const legal: Record<Lang, { updated: string; docs: Record<LegalKind, LegalDoc> }> = {
  en: {
    updated: `Last updated: ${LEGAL_UPDATED}`,
    docs: {
      privacy: {
        title: "Privacy Policy",
        sections: [
          { h: "Overview", p: ["DNext LandslideWatch TH is a landslide risk screening tool. It needs no account and is designed to work on places and rainfall scenarios, not on individuals. Please do not type personal information into the chat."] },
          {
            h: "What we process",
            ul: [
              "Your questions and language choice. They are sent to our servers and processed by Google's Gemini model on Vertex AI to produce an answer.",
              "Scenario inputs and results (area, rainfall, duration). They are cached in Google Cloud Firestore, for up to 24 hours for forecasts and up to 30 days for what-if scenarios, to speed up repeat requests. They are not linked to you.",
              "Technical logs recorded by Google Cloud (time, request ID, IP address, browser details) for security and reliability.",
              "Place searches, which are sent to the Google Maps Platform Geocoding service.",
              "Your location, only if you click \"My location\". Your browser reads it to centre the map; it is not sent to our servers.",
              "Feedback you submit through the embedded Google Form, which is received by us and handled under Google's privacy policy.",
            ],
          },
          { h: "What we do not do", ul: ["We do not sell personal data.", "We do not run advertising or analytics trackers.", "We do not make decisions about individuals or target individual households."] },
          { h: "Retention", p: ["Chat sessions are held in server memory and are discarded when the service restarts or the session expires. Cached scenarios follow the periods above. Cloud logs are typically kept for up to 30 days."] },
          { h: "Service providers", p: ["We use Google Cloud (Cloud Run, Vertex AI, Earth Engine, Firestore, Cloud Storage, Cloud Logging) and Google Maps Platform. These providers process data on our behalf under their own terms."] },
          { h: "Your choices and rights", p: ["You can ask what we hold about you, or ask us to delete it, using the Send feedback button in the header. We aim to handle requests in line with Thailand's Personal Data Protection Act (PDPA) and other applicable law."] },
          { h: "Changes", p: ["We will update this page when our practices change and show the date above."] },
        ],
      },
      cookies: {
        title: "Cookie Policy",
        sections: [
          { h: "Short version", p: ["We do not set advertising or analytics cookies. The app stores one small preference in your browser and relies on Google services that may set their own cookies."] },
          {
            h: "What is stored",
            ul: [
              "lw-theme (local storage, ours): remembers your light or dark theme choice. It stays in your browser until you clear it.",
              "Google Maps (Google): the map may use cookies or local storage that Google needs to deliver map tiles, prevent abuse and measure usage. See Google's policies.",
              "Google Forms (Google): opening the feedback form loads content from google.com, which may set cookies.",
            ],
          },
          { h: "Your choices", p: ["You can clear or block cookies and site data in your browser settings. Blocking Google cookies may stop the map or feedback form from working. Clearing local storage resets your theme to your system setting."] },
        ],
      },
      terms: {
        title: "Terms of Use",
        sections: [
          { h: "Using this tool", p: ["By using DNext LandslideWatch TH you agree to these terms. The tool gives screening-level information to help people explore landslide risk. It is provided free of charge for information and planning."] },
          { h: "Not an official forecast or warning", p: ["Results are not official forecasts, warnings or evacuation advice. Do not use them as the only basis for safety, evacuation or emergency decisions. Follow the Thai Meteorological Department (tmd.go.th), the Department of Disaster Prevention and Mitigation (disaster.go.th) and your local authorities."] },
          { h: "Accuracy and limits", ul: ["The model is a simplified susceptibility screening and is not calibrated for individual slopes or villages.", "Rainfall is assumed to be spatially uniform, and results are coarse estimates. Households are estimated from population.", "AI-generated text can contain mistakes. Figures come from computed results, but they are only as good as the data and assumptions behind them."] },
          { h: "Acceptable use", ul: ["Do not overload, scrape or attempt to disrupt the service.", "Do not use it to target or profile individuals.", "Do not present its output as an official source."] },
          { h: "Third-party data and services", p: ["Maps, datasets and services belong to their providers and stay subject to their terms. See Disclaimer & Data Sources."] },
          { h: "No warranty and liability", p: ["The tool is provided \"as is\" and \"as available\", without warranties of any kind. To the extent the law allows, we are not liable for losses arising from its use or from its unavailability."] },
          { h: "Changes", p: ["We may change the tool or these terms. Continued use means you accept the updated terms."] },
        ],
      },
      disclaimer: {
        title: "Disclaimer & Data Sources",
        sections: [
          { h: "Important", p: ["This is a screening tool, not an official forecast. For official alerts, follow the Thai Meteorological Department (tmd.go.th) and the Department of Disaster Prevention and Mitigation (disaster.go.th)."] },
          {
            h: "Data sources",
            ul: [
              "Terrain: NASADEM (NASA)",
              "Land cover: ESA WorldCover",
              "Forest loss: Hansen / University of Maryland Global Forest Change",
              "Soil: OpenLandMap",
              "Streams: MERIT Hydro",
              "Rainfall: NASA GPM IMERG (observed), NOAA GFS (forecast)",
              "Population: WorldPop",
              "Buildings: Google Open Buildings or GHSL built-up surface, where available",
              "Roads and facilities: OpenStreetMap contributors, where available",
              "Administrative boundaries: OCHA / Royal Thai Survey Department via HDX",
              "Base map and place search: Google Maps Platform",
            ],
          },
          { h: "References", p: ["Informed by NASA LHASA and the ADPC / SERVIR-Mekong LHASA-Mekong landslide work."] },
          { h: "Licences", p: ["Each dataset remains subject to its provider's licence and attribution requirements. Check the provider's terms before reusing any data."] },
        ],
      },
    },
  },
  th: {
    updated: `ปรับปรุงล่าสุด: 13 ตุลาคม 2569`,
    docs: {
      privacy: {
        title: "นโยบายความเป็นส่วนตัว",
        sections: [
          { h: "ภาพรวม", p: ["DNext LandslideWatch TH เป็นเครื่องมือคัดกรองความเสี่ยงดินถล่ม ไม่ต้องสมัครบัญชี และออกแบบมาเพื่อดูพื้นที่และสถานการณ์ฝน ไม่ใช่เพื่อดูข้อมูลรายบุคคล โปรดอย่าพิมพ์ข้อมูลส่วนบุคคลลงในแชท"] },
          {
            h: "ข้อมูลที่เราประมวลผล",
            ul: [
              "คำถามและภาษาที่คุณเลือก ส่งไปยังเซิร์ฟเวอร์ของเราและประมวลผลโดยโมเดล Gemini ของ Google บน Vertex AI เพื่อตอบคำถาม",
              "ข้อมูลนำเข้าและผลของสถานการณ์ (พื้นที่ ปริมาณฝน ระยะเวลา) เก็บแคชใน Google Cloud Firestore นานสูงสุด 24 ชั่วโมงสำหรับการพยากรณ์ และสูงสุด 30 วันสำหรับสถานการณ์สมมติ เพื่อให้ตอบคำขอซ้ำได้เร็วขึ้น โดยไม่เชื่อมโยงกับตัวคุณ",
              "บันทึกทางเทคนิคที่ Google Cloud เก็บ (เวลา รหัสคำขอ ที่อยู่ IP รายละเอียดเบราว์เซอร์) เพื่อความปลอดภัยและเสถียรภาพ",
              "การค้นหาสถานที่ ซึ่งส่งไปยังบริการ Geocoding ของ Google Maps Platform",
              "ตำแหน่งของคุณ เฉพาะเมื่อคุณกด \"ตำแหน่งของฉัน\" เบราว์เซอร์ของคุณอ่านค่าเพื่อจัดกึ่งกลางแผนที่ และไม่ส่งไปยังเซิร์ฟเวอร์ของเรา",
              "ความคิดเห็นที่คุณส่งผ่าน Google Form ที่ฝังไว้ ซึ่งเราได้รับ และอยู่ภายใต้นโยบายความเป็นส่วนตัวของ Google",
            ],
          },
          { h: "สิ่งที่เราไม่ทำ", ul: ["ไม่ขายข้อมูลส่วนบุคคล", "ไม่ใช้ตัวติดตามเพื่อโฆษณาหรือวิเคราะห์การใช้งาน", "ไม่ตัดสินใจเกี่ยวกับรายบุคคล และไม่ระบุเป้าหมายรายครัวเรือน"] },
          { h: "ระยะเวลาเก็บรักษา", p: ["เซสชันแชทอยู่ในหน่วยความจำของเซิร์ฟเวอร์และถูกทิ้งเมื่อบริการรีสตาร์ตหรือเซสชันหมดอายุ แคชของสถานการณ์เป็นไปตามระยะเวลาข้างต้น บันทึกบนคลาวด์โดยทั่วไปเก็บไว้ไม่เกิน 30 วัน"] },
          { h: "ผู้ให้บริการ", p: ["เราใช้ Google Cloud (Cloud Run, Vertex AI, Earth Engine, Firestore, Cloud Storage, Cloud Logging) และ Google Maps Platform ผู้ให้บริการเหล่านี้ประมวลผลข้อมูลแทนเราภายใต้ข้อกำหนดของตนเอง"] },
          { h: "ทางเลือกและสิทธิของคุณ", p: ["คุณสามารถขอทราบว่าเราเก็บข้อมูลใดเกี่ยวกับคุณ หรือขอให้ลบ ได้ผ่านปุ่ม \"ส่งความคิดเห็น\" ที่แถบด้านบน เรามุ่งดำเนินการตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล (PDPA) และกฎหมายที่เกี่ยวข้อง"] },
          { h: "การเปลี่ยนแปลง", p: ["เราจะปรับปรุงหน้านี้เมื่อแนวปฏิบัติเปลี่ยน และแสดงวันที่ไว้ด้านบน"] },
        ],
      },
      cookies: {
        title: "นโยบายคุกกี้",
        sections: [
          { h: "สรุปสั้น ๆ", p: ["เราไม่ตั้งคุกกี้เพื่อโฆษณาหรือวิเคราะห์การใช้งาน แอปเก็บค่าที่ตั้งไว้หนึ่งรายการในเบราว์เซอร์ และใช้บริการของ Google ซึ่งอาจตั้งคุกกี้ของตนเอง"] },
          {
            h: "สิ่งที่ถูกจัดเก็บ",
            ul: [
              "lw-theme (local storage ของเรา): จำธีมสว่างหรือมืดที่คุณเลือก อยู่ในเบราว์เซอร์ของคุณจนกว่าจะล้าง",
              "Google Maps (Google): แผนที่อาจใช้คุกกี้หรือ local storage ที่ Google ต้องใช้เพื่อส่งภาพแผนที่ ป้องกันการใช้งานผิดปกติ และวัดการใช้งาน ดูนโยบายของ Google",
              "Google Forms (Google): การเปิดแบบฟอร์มความคิดเห็นจะโหลดเนื้อหาจาก google.com ซึ่งอาจตั้งคุกกี้",
            ],
          },
          { h: "ทางเลือกของคุณ", p: ["คุณล้างหรือบล็อกคุกกี้และข้อมูลไซต์ได้ในการตั้งค่าเบราว์เซอร์ การบล็อกคุกกี้ของ Google อาจทำให้แผนที่หรือแบบฟอร์มความคิดเห็นใช้งานไม่ได้ การล้าง local storage จะรีเซ็ตธีมกลับไปตามการตั้งค่าของระบบ"] },
        ],
      },
      terms: {
        title: "ข้อกำหนดการใช้งาน",
        sections: [
          { h: "การใช้เครื่องมือนี้", p: ["การใช้ DNext LandslideWatch TH ถือว่าคุณยอมรับข้อกำหนดเหล่านี้ เครื่องมือให้ข้อมูลคัดกรองเบื้องต้นเพื่อช่วยให้สำรวจความเสี่ยงดินถล่ม ให้บริการโดยไม่คิดค่าใช้จ่ายเพื่อข้อมูลและการวางแผน"] },
          { h: "ไม่ใช่การพยากรณ์หรือการเตือนภัยอย่างเป็นทางการ", p: ["ผลลัพธ์ไม่ใช่การพยากรณ์ การเตือนภัย หรือคำแนะนำการอพยพอย่างเป็นทางการ อย่าใช้เป็นเกณฑ์เดียวในการตัดสินใจด้านความปลอดภัย การอพยพ หรือเหตุฉุกเฉิน โปรดติดตามกรมอุตุนิยมวิทยา (tmd.go.th) กรมป้องกันและบรรเทาสาธารณภัย (disaster.go.th) และหน่วยงานท้องถิ่น"] },
          { h: "ความแม่นยำและข้อจำกัด", ul: ["โมเดลเป็นการคัดกรองความอ่อนไหวแบบง่าย ไม่ได้ปรับเทียบสำหรับเนินเขาหรือหมู่บ้านแต่ละแห่ง", "สมมติว่าฝนตกสม่ำเสมอทั่วพื้นที่ ผลลัพธ์เป็นค่าประมาณอย่างหยาบ ครัวเรือนประมาณจากจำนวนประชากร", "ข้อความที่สร้างโดย AI อาจมีข้อผิดพลาด ตัวเลขมาจากผลการคำนวณ แต่ขึ้นอยู่กับคุณภาพของข้อมูลและสมมติฐาน"] },
          { h: "การใช้งานที่ยอมรับได้", ul: ["ห้ามทำให้บริการทำงานหนักเกินควร ดึงข้อมูลอัตโนมัติ หรือพยายามรบกวนบริการ", "ห้ามใช้เพื่อระบุเป้าหมายหรือสร้างโปรไฟล์รายบุคคล", "ห้ามนำผลลัพธ์ไปอ้างว่าเป็นแหล่งข้อมูลทางการ"] },
          { h: "ข้อมูลและบริการของบุคคลที่สาม", p: ["แผนที่ ชุดข้อมูล และบริการเป็นของผู้ให้บริการแต่ละราย และอยู่ภายใต้ข้อกำหนดของผู้ให้บริการนั้น ดู \"ข้อจำกัดความรับผิดและแหล่งข้อมูล\""] },
          { h: "ไม่มีการรับประกันและความรับผิด", p: ["เครื่องมือให้บริการตามสภาพ \"ตามที่เป็น\" และ \"ตามที่มี\" โดยไม่มีการรับประกันใด ๆ ภายใต้ขอบเขตที่กฎหมายอนุญาต เราไม่รับผิดต่อความเสียหายที่เกิดจากการใช้หรือการที่ใช้งานไม่ได้"] },
          { h: "การเปลี่ยนแปลง", p: ["เราอาจเปลี่ยนแปลงเครื่องมือหรือข้อกำหนดนี้ การใช้งานต่อไปถือว่าคุณยอมรับข้อกำหนดที่ปรับปรุงแล้ว"] },
        ],
      },
      disclaimer: {
        title: "ข้อจำกัดความรับผิดและแหล่งข้อมูล",
        sections: [
          { h: "สำคัญ", p: ["นี่เป็นเครื่องมือคัดกรองเบื้องต้น ไม่ใช่การพยากรณ์อย่างเป็นทางการ สำหรับการแจ้งเตือนทางการ โปรดติดตามกรมอุตุนิยมวิทยา (tmd.go.th) และกรมป้องกันและบรรเทาสาธารณภัย (disaster.go.th)"] },
          {
            h: "แหล่งข้อมูล",
            ul: [
              "ภูมิประเทศ: NASADEM (NASA)",
              "สิ่งปกคลุมดิน: ESA WorldCover",
              "การสูญเสียป่า: Hansen / University of Maryland Global Forest Change",
              "ดิน: OpenLandMap",
              "ลำน้ำ: MERIT Hydro",
              "ปริมาณฝน: NASA GPM IMERG (ตรวจวัด), NOAA GFS (พยากรณ์)",
              "ประชากร: WorldPop",
              "อาคาร: Google Open Buildings หรือ GHSL เท่าที่มีข้อมูล",
              "ถนนและสิ่งอำนวยความสะดวก: ผู้ร่วมจัดทำ OpenStreetMap เท่าที่มีข้อมูล",
              "ขอบเขตการปกครอง: OCHA / กรมแผนที่ทหาร (Royal Thai Survey Department) ผ่าน HDX",
              "แผนที่พื้นฐานและการค้นหาสถานที่: Google Maps Platform",
            ],
          },
          { h: "เอกสารอ้างอิง", p: ["อ้างอิงงาน NASA LHASA และ LHASA-Mekong ของ ADPC / SERVIR-Mekong"] },
          { h: "ใบอนุญาต", p: ["ชุดข้อมูลแต่ละชุดอยู่ภายใต้ใบอนุญาตและข้อกำหนดการอ้างอิงของผู้ให้บริการ โปรดตรวจสอบข้อกำหนดก่อนนำข้อมูลไปใช้ซ้ำ"] },
        ],
      },
    },
  },
};
