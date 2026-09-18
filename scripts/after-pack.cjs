// เซ็นแบบ ad-hoc ให้ทั้ง bundle หลัง electron-builder ประกอบเสร็จ
//
// 🔴 ทำไมต้องมี: Electron แจก binary ที่ "linker-signed" มาแล้ว (จำเป็นสำหรับ Apple Silicon)
//    แต่ลายเซ็นนั้นเป็นของ "ไฟล์ไบนารี" ไม่ใช่ของ "ทั้งกล่องแอป" → กล่องไม่มี _CodeSignature
//    codesign -v จะบอกว่า "code has no resources but signature indicates they must be present"
//    ผลคือ **ดับเบิลคลิกใน Finder แล้วแอปไม่ขึ้น** (LaunchServices ปฏิเสธเงียบ ๆ)
//    แต่รันไบนารีข้างในตรง ๆ จาก terminal กลับได้ — จึงหลุดการตรวจไปได้ง่ายมาก
//
//    อาการนี้พังทั้งการแจกและการอัปเดต (สคริปต์สลับแอปจบด้วย `open`)
//
// นี่ไม่ใช่การเซ็นด้วย Developer ID — ยังไม่ผ่าน Gatekeeper สำหรับไฟล์ที่ติด quarantine
// แต่ทำให้ "กล่องแอปถูกต้อง" ซึ่งเป็นคนละเรื่องกันและจำเป็นทั้งคู่
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', app], { stdio: 'inherit' });
  console.log(`  • เซ็น ad-hoc ทั้ง bundle แล้ว  ${app}`);
};
