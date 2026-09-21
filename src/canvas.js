// เครื่องมือ "My Canvas" ของ Cobi — MCP server ที่รันอยู่ในตัวแอปเอง (ไม่ใช่ที่เซิร์ฟเวอร์)
//
// ทำไมต้องอยู่ในแอป ไม่ใช่ /api/mcp เหมือนเครื่องมืออื่น:
//   canvas ของผู้ใช้เก็บใน localStorage ของหน้าเว็บ (ของส่วนตัว ไม่ขึ้นฐานข้อมูล)
//   เซิร์ฟเวอร์จึงเอื้อมไม่ถึง — คนเดียวที่แตะได้คือหน้าเว็บที่เปิดอยู่ฝั่งซ้ายของหน้าต่างนี้
//   เครื่องมือชุดนี้เลยเป็นแค่ "ท่อ" ส่งคำสั่งข้ามไปให้หน้าเว็บลงมือแทน
//
// ทางเดินหนึ่งครั้ง: Cobi → ตรงนี้ → main.js (askWeb) → preload-web → DesktopCanvasBridge
//
// ด่านอนุญาต: canvas_write ไม่อยู่ในรายการผ่านอัตโนมัติของ main.js
// → เด้งการ์ดถามในแผงทุกครั้ง ผู้ใช้เป็นคนกดเอง (ดู canUseTool ใน main.js)
// require แบบขี้เกียจเหมือน agent.js — SDK เป็นโมดูลหนัก ไม่ควรถ่วงตอนเปิดแอป
const getSdk = () => require('@anthropic-ai/claude-agent-sdk');
const getZ = () => require('zod').z;

const SERVER_NAME = 'cobik_canvas';

const ok = (v) => ({
  content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
});
const fail = (m) => ({ content: [{ type: 'text', text: `❌ ${m}` }], isError: true });

/**
 * @param ask (op, args) => Promise<any> — ส่งคำสั่งไปให้หน้าเว็บทำ (main.js เป็นคนต่อให้)
 */
function build(ask) {
  const { createSdkMcpServer, tool } = getSdk();
  const z = getZ();
  const run = async (op, args) => {
    try { return ok(await ask(op, args || {})); }
    catch (e) { return fail(e?.message || String(e)); }
  };

  return createSdkMcpServer({
    name: SERVER_NAME,
    version: '1.0.0',
    instructions:
      'My Canvas คือหน้าจอส่วนตัวของผู้ใช้ในแอป cobik — ไฟล์ HTML หนึ่งไฟล์ที่วาดข้อมูลทีมจริง '
      + 'ตามที่เจ้าตัวอยากเห็น เขียนเข้าไปได้เลยจากที่นี่ ไม่ต้องให้ผู้ใช้เซฟไฟล์หรืออัปโหลดเอง '
      + 'อ่าน canvas_guide ก่อนเขียนครั้งแรกของบทสนทนาเสมอ',
    tools: [
      tool(
        'canvas_guide',
        'คู่มือเขียน canvas ฉบับเต็ม — มีข้อมูลที่หยิบได้พร้อมตัวอย่างจริงของทีมนี้ · ตัวแปรธีม · '
        + 'กติกาของกล่องทราย · เทมเพลตตั้งต้น 🔴 ต้องเรียกก่อนเขียน canvas ครั้งแรกในบทสนทนาเสมอ '
        + 'ห้ามเดารูปร่างข้อมูลเอง',
        {},
        async () => run('guide'),
      ),
      tool(
        'canvas_list',
        'รายการ canvas ที่ผู้ใช้มีอยู่ตอนนี้ (id · ชื่อ · สิทธิ์ · ขนาด) — ใช้หาว่าจะแก้อันไหน '
        + 'และดูว่าเต็มโควตาหรือยัง',
        {},
        async () => run('list'),
      ),
      tool(
        'canvas_read',
        'อ่าน HTML ของ canvas ที่มีอยู่ — เรียกก่อนแก้เสมอ จะได้แก้ของเดิม ไม่ใช่เขียนใหม่ทั้งหน้า',
        { id: z.string().describe('id ของ canvas จาก canvas_list') },
        async (a) => run('read', a),
      ),
      tool(
        'canvas_write',
        'เขียน canvas เข้าแอป — ไม่ส่ง id = สร้างใหม่ · ส่ง id = เขียนทับอันนั้น (ชื่อกับสิทธิ์เดิมคงอยู่) '
        + 'ผู้ใช้ต้องกดอนุญาตก่อนทุกครั้ง แล้วแท็บจะเด้งขึ้นให้เห็นผลทันที '
        + 'ของใหม่เริ่มต้นอ่านอย่างเดียวเสมอ — ถ้า canvas ต้องแก้ข้อมูลจริง บอกผู้ใช้ให้กด 🛡 บนแท็บเอง',
        {
          html: z.string().describe('ไฟล์ HTML ทั้งไฟล์ (CSS/JS รวมอยู่ในนี้) ตามกติกาใน canvas_guide'),
          name: z.string().optional().describe('ชื่อแท็บ สั้น ๆ อ่านรู้เรื่อง (ตอนเขียนทับ ไม่ส่ง = ใช้ชื่อเดิม)'),
          id: z.string().optional().describe('ใส่เมื่อจะเขียนทับ canvas เดิมเท่านั้น'),
        },
        async (a) => run('write', a),
      ),
    ],
  });
}

module.exports = { build, SERVER_NAME };
