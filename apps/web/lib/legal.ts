import type { Lang } from "./types";

export type LegalKind = "privacy" | "cookies" | "terms" | "disclaimer";
export interface Section { h: string; p?: string[]; ul?: string[] }
export interface LegalDoc { title: string; sections: Section[] }

export const LEGAL_UPDATED = "15 October 2026";

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
          { h: "Overview", p: ["DNext LandslideWatch TH is a landslide risk screening tool. You can browse the map and the national overview without an account. To use the chat and to run scenarios you sign in with Google, so that fair-use limits can be applied per account. The tool is designed to work on places and rainfall scenarios, not on individuals. Please do not type personal information into the chat."] },
          {
            h: "What we process",
            ul: [
              "Your questions and language choice. They are sent to our servers and processed by Google's Gemini model on Vertex AI to produce an answer.",
              "Scenario inputs and results (area, rainfall, duration). They are cached in Google Cloud Firestore, for up to 24 hours for forecasts and up to 30 days for what-if scenarios, to speed up repeat requests. They are not linked to you.",
              "Technical logs recorded by Google Cloud (time, request ID, IP address, browser details) for security and reliability.",
              "Place searches, which are sent to the Google Maps Platform Geocoding service.",
              "Your location, only if you click \"My location\" or use it in Safe places or a report. Your browser reads it to centre the map. For Safe places, the point is sent to our server to find nearby places and is not stored. For a route preview, the start and end points are sent to the Google Routes API through our server and are not stored.",
              "A photo you send in Photo check or in a community report. It is resized on your device and sent to our server, where Gemini looks at it once. The photo is not stored and its location data is removed.",
              "A community report (the kind of problem, a short description written by the AI, the place rounded to about 100 m, the time and the tambon) is saved in Cloud Firestore for 48 hours (7 days for slope damage) so that it can be shown on the map to everyone. It is linked to a one-way hash of your account only to limit repeated reports and flags.",
              "Feedback you submit through the embedded Google Form, which is received by us and handled under Google's privacy policy.",
              "If you sign in with Google: sign-in is run by Firebase Authentication (a Google Cloud service). Firebase keeps an account record for you in our project (a user ID, your email, name and picture from your Google account, and sign-in times). Our API only checks the sign-in token and stores a one-way hashed account ID with your daily usage counts (chats and scenario runs), for about 3 days, to apply the limits. We do not receive or store your Google password. You can ask us to delete your account record.",
            ],
          },
          { h: "What we do not do", ul: ["We do not sell personal data.", "We do not run advertising or analytics trackers.", "We do not use your Google sign-in for anything except identifying your account for fair-use limits.", "We do not make decisions about individuals or target individual households."] },
          { h: "Retention", p: ["The assistant's working memory is held in server memory and is discarded when the service restarts or the session expires. Your chat history is saved in your browser (local storage) so that you can reopen a conversation, and you can delete any chat from the History list. If you are signed in, a copy of each chat is also saved in Cloud Firestore under your one-way hashed account ID for 90 days after the last message; deleting a chat removes both copies. Cached scenarios follow the periods above. Usage counters are kept for about 3 days. Your sign-in session stays in your browser until you sign out. Cloud logs are typically kept for up to 30 days."] },
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
              "dnext-theme (local storage, ours): remembers your light or dark theme choice. It stays in your browser until you clear it.",
              "dnext-chats-v1 (local storage, ours): your saved chat history (up to 30 chats). It stays in your browser until you delete the chats or clear site data.",
              "Google Maps (Google): the map may use cookies or local storage that Google needs to deliver map tiles, prevent abuse and measure usage. See Google's policies.",
              "Google Forms (Google): opening the feedback form loads content from google.com, which may set cookies.",
              "Sign in with Google (Firebase Authentication, Google): signing in opens a Google window, and Google or Firebase may set cookies. After you sign in, Firebase keeps your session in your browser's storage (IndexedDB / local storage, keys starting with firebase:) until you sign out.",
            ],
          },
          { h: "Your choices", p: ["You can clear or block cookies and site data in your browser settings. Blocking Google cookies may stop the map or feedback form from working. Clearing local storage resets your theme to your system setting."] },
        ],
      },
      terms: {
        title: "Terms of Use",
        sections: [
          { h: "Using this tool", p: ["By using DNext LandslideWatch TH you agree to these terms. The tool gives screening-level information to help people explore landslide risk. It is provided free of charge for information and planning."] },
          { h: "Screening results, not safety advice", p: ["Results are screening-level estimates for planning and situational awareness. They are not a forecast, warning or evacuation advice. Do not use them as the only basis for safety, evacuation or emergency decisions; confirm with your local authorities and local conditions."] },
          { h: "Accuracy and limits", ul: ["The method is a simplified national screening and is not calibrated for individual slopes or villages.", "Rainfall is assumed to be spatially uniform, and results are coarse estimates. Households are estimated from population.", "AI-generated text can contain mistakes. Figures come from computed results, but they are only as good as the data and assumptions behind them."] },
          { h: "Acceptable use", ul: ["Do not overload, scrape or attempt to disrupt the service.", "Do not use it to target or profile individuals.", "Do not share, resell or automate use of your account, or create accounts to get around the fair-use limits.", "Do not present its output as a warning or as verified data."] },
          { h: "Accounts and fair use", p: ["Chat and scenario runs need a Google sign-in. Each account has daily and per-minute limits (currently 30 chats and 200 scenario or forecast runs per day). Limits reset at midnight Thailand time and may change. We may restrict access that looks abusive."] },
          { h: "Third-party data and services", p: ["Maps, datasets and services belong to their providers and stay subject to their terms. See Disclaimer & Data Sources."] },
          { h: "No warranty and liability", p: ["The tool is provided \"as is\" and \"as available\", without warranties of any kind. To the extent the law allows, we are not liable for losses arising from its use or from its unavailability."] },
          { h: "Changes", p: ["We may change the tool or these terms. Continued use means you accept the updated terms."] },
        ],
      },
      disclaimer: {
        title: "Disclaimer & Data Sources",
        sections: [
          { h: "Important", p: ["This is a screening tool for planning and situational awareness. Results are estimates: confirm with local sources before acting."] },
          {
            h: "Data sources",
            ul: [
              "Landslide susceptibility, vulnerability, exposure and tambon rainfall thresholds: ADPC, accessed through Google Earth Engine",
              "Rainfall: JAXA GSMaP (observed), NOAA GFS (forecast)",
              "Population: WorldPop",
              "Buildings: GHSL built-up surface (European Commission JRC)",
              "Roads and facilities: OpenStreetMap contributors, where available",
              "Base map and place search: Google Maps Platform",
            ],
          },
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
          { h: "ภาพรวม", p: ["DNext LandslideWatch TH เป็นเครื่องมือคัดกรองความเสี่ยงดินถล่ม ดูแผนที่และภาพรวมระดับประเทศได้โดยไม่ต้องมีบัญชี การใช้แชทและการคำนวณสถานการณ์ต้องลงชื่อเข้าใช้ด้วย Google เพื่อให้กำหนดขีดจำกัดการใช้งานที่เป็นธรรมต่อบัญชีได้ เครื่องมือนี้ออกแบบมาเพื่อดูพื้นที่และสถานการณ์ฝน ไม่ใช่เพื่อดูข้อมูลรายบุคคล โปรดอย่าพิมพ์ข้อมูลส่วนบุคคลลงในแชท"] },
          {
            h: "ข้อมูลที่เราประมวลผล",
            ul: [
              "คำถามและภาษาที่คุณเลือก ส่งไปยังเซิร์ฟเวอร์ของเราและประมวลผลโดยโมเดล Gemini ของ Google บน Vertex AI เพื่อตอบคำถาม",
              "ข้อมูลนำเข้าและผลของสถานการณ์ (พื้นที่ ปริมาณฝน ระยะเวลา) เก็บแคชใน Google Cloud Firestore นานสูงสุด 24 ชั่วโมงสำหรับการพยากรณ์ และสูงสุด 30 วันสำหรับสถานการณ์สมมติ เพื่อให้ตอบคำขอซ้ำได้เร็วขึ้น โดยไม่เชื่อมโยงกับตัวคุณ",
              "บันทึกทางเทคนิคที่ Google Cloud เก็บ (เวลา รหัสคำขอ ที่อยู่ IP รายละเอียดเบราว์เซอร์) เพื่อความปลอดภัยและเสถียรภาพ",
              "การค้นหาสถานที่ ซึ่งส่งไปยังบริการ Geocoding ของ Google Maps Platform",
              "ตำแหน่งของคุณ เฉพาะเมื่อคุณกด \"ตำแหน่งของฉัน\" หรือใช้ในสถานที่ปลอดภัยหรือรายงาน เบราว์เซอร์อ่านค่าเพื่อจัดกึ่งกลางแผนที่ สำหรับสถานที่ปลอดภัย จุดนี้ถูกส่งไปยังเซิร์ฟเวอร์เพื่อค้นหาสถานที่ใกล้เคียงและไม่ถูกเก็บ สำหรับตัวอย่างเส้นทาง จุดเริ่มต้นและปลายทางถูกส่งไปยัง Google Routes API ผ่านเซิร์ฟเวอร์ของเราและไม่ถูกเก็บ",
              "ภาพที่คุณส่งในการตรวจภาพถ่ายหรือรายงานจากชุมชน ภาพถูกย่อขนาดบนอุปกรณ์ของคุณและส่งไปยังเซิร์ฟเวอร์ ซึ่ง Gemini ดูเพียงครั้งเดียว ภาพไม่ถูกเก็บและข้อมูลตำแหน่งในภาพถูกลบออก",
              "รายงานจากชุมชน (ประเภทของปัญหา คำอธิบายสั้นที่ AI เขียน ตำแหน่งที่ปัดเป็นประมาณ 100 ม. เวลา และตำบล) ถูกบันทึกใน Cloud Firestore นาน 48 ชั่วโมง (7 วันสำหรับความเสียหายของเนิน) เพื่อแสดงบนแผนที่ให้ทุกคนเห็น และเชื่อมกับแฮชทางเดียวของบัญชีคุณเพียงเพื่อจำกัดการรายงานและการแจ้งซ้ำ",
              "ความคิดเห็นที่คุณส่งผ่าน Google Form ที่ฝังไว้ ซึ่งเราได้รับ และอยู่ภายใต้นโยบายความเป็นส่วนตัวของ Google",
              "หากคุณลงชื่อเข้าใช้ด้วย Google: การลงชื่อเข้าใช้ดำเนินการโดย Firebase Authentication (บริการของ Google Cloud) ซึ่ง Firebase เก็บบันทึกบัญชีของคุณไว้ในโปรเจกต์ของเรา (รหัสผู้ใช้ อีเมล ชื่อ และรูปภาพจากบัญชี Google และเวลาที่ลงชื่อเข้าใช้) ส่วน API ของเราตรวจสอบเฉพาะโทเค็นการลงชื่อเข้าใช้ และเก็บรหัสบัญชีที่ผ่านการแฮชแบบทางเดียวพร้อมจำนวนการใช้งานรายวัน (แชทและการคำนวณสถานการณ์) ประมาณ 3 วัน เพื่อบังคับใช้ขีดจำกัด เราไม่ได้รับหรือเก็บรหัสผ่าน Google ของคุณ คุณสามารถขอให้เราลบบันทึกบัญชีของคุณได้",
            ],
          },
          { h: "สิ่งที่เราไม่ทำ", ul: ["ไม่ขายข้อมูลส่วนบุคคล", "ไม่ใช้ตัวติดตามเพื่อโฆษณาหรือวิเคราะห์การใช้งาน", "ไม่ใช้การลงชื่อเข้าใช้ Google ของคุณเพื่อสิ่งอื่นนอกจากระบุบัญชีสำหรับขีดจำกัดการใช้งานที่เป็นธรรม", "ไม่ตัดสินใจเกี่ยวกับรายบุคคล และไม่ระบุเป้าหมายรายครัวเรือน"] },
          { h: "ระยะเวลาเก็บรักษา", p: ["หน่วยความจำการทำงานของผู้ช่วยอยู่ในหน่วยความจำของเซิร์ฟเวอร์และถูกทิ้งเมื่อบริการรีสตาร์ตหรือเซสชันหมดอายุ ประวัติการแชทของคุณถูกบันทึกในเบราว์เซอร์ (local storage) เพื่อให้เปิดบทสนทนากลับมาดูได้ และคุณลบแชทใดก็ได้จากรายการประวัติ หากคุณลงชื่อเข้าใช้ สำเนาของแต่ละแชทจะถูกบันทึกใน Cloud Firestore ภายใต้รหัสบัญชีที่แฮชแบบทางเดียวเป็นเวลา 90 วันหลังข้อความล่าสุด การลบแชทจะลบทั้งสองสำเนา แคชของสถานการณ์เป็นไปตามระยะเวลาข้างต้น ตัวนับการใช้งานเก็บไว้ประมาณ 3 วัน เซสชันการลงชื่อเข้าใช้ของคุณอยู่ในเบราว์เซอร์จนกว่าคุณจะออกจากระบบ บันทึกบนคลาวด์โดยทั่วไปเก็บไว้ไม่เกิน 30 วัน"] },
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
              "dnext-theme (local storage ของเรา): จำธีมสว่างหรือมืดที่คุณเลือก อยู่ในเบราว์เซอร์ของคุณจนกว่าจะล้าง",
              "dnext-chats-v1 (local storage ของเรา): ประวัติการแชทที่บันทึกไว้ (สูงสุด 30 แชท) อยู่ในเบราว์เซอร์ของคุณจนกว่าจะลบแชทหรือล้างข้อมูลไซต์",
              "Google Maps (Google): แผนที่อาจใช้คุกกี้หรือ local storage ที่ Google ต้องใช้เพื่อส่งภาพแผนที่ ป้องกันการใช้งานผิดปกติ และวัดการใช้งาน ดูนโยบายของ Google",
              "Google Forms (Google): การเปิดแบบฟอร์มความคิดเห็นจะโหลดเนื้อหาจาก google.com ซึ่งอาจตั้งคุกกี้",
              "ลงชื่อเข้าใช้ด้วย Google (Firebase Authentication, Google): การลงชื่อเข้าใช้จะเปิดหน้าต่างของ Google ซึ่ง Google หรือ Firebase อาจตั้งคุกกี้ หลังลงชื่อเข้าใช้ Firebase จะเก็บเซสชันของคุณในที่เก็บข้อมูลของเบราว์เซอร์ (IndexedDB / local storage คีย์ที่ขึ้นต้นด้วย firebase:) จนกว่าคุณจะออกจากระบบ",
            ],
          },
          { h: "ทางเลือกของคุณ", p: ["คุณล้างหรือบล็อกคุกกี้และข้อมูลไซต์ได้ในการตั้งค่าเบราว์เซอร์ การบล็อกคุกกี้ของ Google อาจทำให้แผนที่หรือแบบฟอร์มความคิดเห็นใช้งานไม่ได้ การล้าง local storage จะรีเซ็ตธีมกลับไปตามการตั้งค่าของระบบ"] },
        ],
      },
      terms: {
        title: "ข้อกำหนดการใช้งาน",
        sections: [
          { h: "การใช้เครื่องมือนี้", p: ["การใช้ DNext LandslideWatch TH ถือว่าคุณยอมรับข้อกำหนดเหล่านี้ เครื่องมือให้ข้อมูลคัดกรองเบื้องต้นเพื่อช่วยให้สำรวจความเสี่ยงดินถล่ม ให้บริการโดยไม่คิดค่าใช้จ่ายเพื่อข้อมูลและการวางแผน"] },
          { h: "ผลคัดกรอง ไม่ใช่คำแนะนำด้านความปลอดภัย", p: ["ผลลัพธ์เป็นค่าประมาณเบื้องต้นเพื่อการวางแผนและการรับรู้สถานการณ์ ไม่ใช่การพยากรณ์ การเตือนภัย หรือคำแนะนำการอพยพ อย่าใช้เป็นเกณฑ์เดียวในการตัดสินใจด้านความปลอดภัย การอพยพ หรือเหตุฉุกเฉิน โปรดตรวจสอบกับหน่วยงานท้องถิ่นและสภาพพื้นที่จริง"] },
          { h: "ความแม่นยำและข้อจำกัด", ul: ["วิธีนี้เป็นการคัดกรองระดับประเทศแบบง่าย ไม่ได้ปรับเทียบสำหรับเนินเขาหรือหมู่บ้านแต่ละแห่ง", "สมมติว่าฝนตกสม่ำเสมอทั่วพื้นที่ ผลลัพธ์เป็นค่าประมาณอย่างหยาบ ครัวเรือนประมาณจากจำนวนประชากร", "ข้อความที่สร้างโดย AI อาจมีข้อผิดพลาด ตัวเลขมาจากผลการคำนวณ แต่ขึ้นอยู่กับคุณภาพของข้อมูลและสมมติฐาน"] },
          { h: "การใช้งานที่ยอมรับได้", ul: ["ห้ามทำให้บริการทำงานหนักเกินควร ดึงข้อมูลอัตโนมัติ หรือพยายามรบกวนบริการ", "ห้ามใช้เพื่อระบุเป้าหมายหรือสร้างโปรไฟล์รายบุคคล", "ห้ามแชร์ ขายต่อ หรือใช้บัญชีของคุณแบบอัตโนมัติ และห้ามสร้างบัญชีเพื่อหลีกเลี่ยงขีดจำกัดการใช้งานที่เป็นธรรม", "ห้ามนำผลลัพธ์ไปอ้างว่าเป็นคำเตือนหรือข้อมูลที่ผ่านการยืนยันแล้ว"] },
          { h: "บัญชีและการใช้งานที่เป็นธรรม", p: ["แชทและการคำนวณสถานการณ์ต้องลงชื่อเข้าใช้ด้วย Google แต่ละบัญชีมีขีดจำกัดรายวันและรายนาที (ปัจจุบัน 30 แชทและ 200 ครั้งของการคำนวณสถานการณ์หรือการพยากรณ์ต่อวัน) ขีดจำกัดรีเซ็ตเวลาเที่ยงคืนตามเวลาประเทศไทยและอาจเปลี่ยนแปลงได้ เราอาจจำกัดการเข้าถึงที่ดูเหมือนเป็นการใช้งานในทางที่ผิด"] },
          { h: "ข้อมูลและบริการของบุคคลที่สาม", p: ["แผนที่ ชุดข้อมูล และบริการเป็นของผู้ให้บริการแต่ละราย และอยู่ภายใต้ข้อกำหนดของผู้ให้บริการนั้น ดู \"ข้อจำกัดความรับผิดและแหล่งข้อมูล\""] },
          { h: "ไม่มีการรับประกันและความรับผิด", p: ["เครื่องมือให้บริการตามสภาพ \"ตามที่เป็น\" และ \"ตามที่มี\" โดยไม่มีการรับประกันใด ๆ ภายใต้ขอบเขตที่กฎหมายอนุญาต เราไม่รับผิดต่อความเสียหายที่เกิดจากการใช้หรือการที่ใช้งานไม่ได้"] },
          { h: "การเปลี่ยนแปลง", p: ["เราอาจเปลี่ยนแปลงเครื่องมือหรือข้อกำหนดนี้ การใช้งานต่อไปถือว่าคุณยอมรับข้อกำหนดที่ปรับปรุงแล้ว"] },
        ],
      },
      disclaimer: {
        title: "ข้อจำกัดความรับผิดและแหล่งข้อมูล",
        sections: [
          { h: "สำคัญ", p: ["นี่เป็นเครื่องมือคัดกรองเบื้องต้นเพื่อการวางแผนและการรับรู้สถานการณ์ ผลลัพธ์เป็นค่าประมาณ โปรดตรวจสอบกับแหล่งข้อมูลในพื้นที่ก่อนดำเนินการ"] },
          {
            h: "แหล่งข้อมูล",
            ul: [
              "ความอ่อนไหวต่อดินถล่ม ความเปราะบาง การรับสัมผัส และเกณฑ์ปริมาณฝนระดับตำบล: ADPC เข้าถึงผ่าน Google Earth Engine",
              "ปริมาณฝน: JAXA GSMaP (ตรวจวัด), NOAA GFS (พยากรณ์)",
              "ประชากร: WorldPop",
              "อาคาร: พื้นที่ก่อสร้าง GHSL (คณะกรรมาธิการยุโรป JRC)",
              "ถนนและสิ่งอำนวยความสะดวก: ผู้ร่วมจัดทำ OpenStreetMap เท่าที่มีข้อมูล",
              "แผนที่พื้นฐานและการค้นหาสถานที่: Google Maps Platform",
            ],
          },
          { h: "ใบอนุญาต", p: ["ชุดข้อมูลแต่ละชุดอยู่ภายใต้ใบอนุญาตและข้อกำหนดการอ้างอิงของผู้ให้บริการ โปรดตรวจสอบข้อกำหนดก่อนนำข้อมูลไปใช้ซ้ำ"] },
        ],
      },
    },
  },
};
