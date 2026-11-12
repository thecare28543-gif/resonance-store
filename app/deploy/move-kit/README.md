# Move kit: install the whole system on a new PC

Make the kit on the OLD PC (folder name in plain English, e.g. `MOVE_ResonanceStore_<date>`):
1. copy the whole app folder in as `RESONANCE_STORE_2027\` (without `data\` and without `server-config.json`)
2. dump the database next to it (contains real data: never commit):
   `pg_dump -h localhost -U rs_app -d resonance_store -Fc --no-owner --no-privileges -f resonance_store.dump`
3. copy `INSTALL.bat` + `install_new_pc.ps1` from this folder in

On the NEW PC: install Node.js LTS + PostgreSQL 18, then double-click `INSTALL.bat` (asks for administrator).
It copies the app to `C:\ResonanceStore2027`, creates `rs_app` (new random password) + `resonance_store`, restores the dump,
writes `server-config.json`, registers auto-start at log-on, opens TCP 8081 (Domain/Private) and opens the log-in page.
It never overwrites an existing install or database. The postgres password is not needed (pg_hba is trusted for
localhost for a few seconds and restored exactly).

The Thai guide that goes in the kit:

```
RESONANCE STORE · ชุดย้ายไปเครื่องใหม่ · 11 พ.ย. 2569
=====================================================

⚠ ข้อมูลภายในบริษัท — มีข้อมูลงานจริง ชื่อ + GID พนักงาน 12 คน · ห้ามส่งออกนอกบริษัท

ในชุดนี้
  RESONANCE_STORE_2027\    โฟลเดอร์เว็บทั้งหมด (รวมเอกสาร/คลิป Kaizen)
  resonance_store.dump     ข้อมูลทั้งหมดจากเครื่องเดิม: งานบนชั้น 40 แถว, Job 2,090, Hold,
                           ผลอบรม, บัญชีผู้ใช้ 12 คน, ประวัติ, Backup (ณ 11 พ.ย. 69 17:25)
  INSTALL.bat              ดับเบิลคลิกเพื่อติดตั้ง
  install_new_pc.ps1       ตัวติดตั้ง (INSTALL.bat เรียกให้เอง)

ขั้นตอนที่เครื่องใหม่
---------------------
1. ติดตั้งโปรแกรม 2 ตัวก่อน (ต้องเป็นแอดมินของเครื่อง หรือให้ IT ลงให้)
   - Node.js LTS            https://nodejs.org
   - PostgreSQL 18 (Windows x86-64)   https://www.postgresql.org/download/windows/
     ตอนติดตั้งให้ตั้งรหัส postgres อะไรก็ได้ (ตัวติดตั้งของเราไม่ต้องใช้รหัสนี้) · พอร์ต 5432 ตามค่าเดิม
2. ก๊อปทั้งโฟลเดอร์ MOVE_ResonanceStore_20261111 ไปเครื่องใหม่ (USB / แชร์ไดรฟ์)
3. ดับเบิลคลิก INSTALL.bat → กด Yes ให้สิทธิ์แอดมิน → รอจนขึ้น DONE
   ตัวติดตั้งจะ:
   - ก๊อปเว็บไปไว้ที่ C:\ResonanceStore2027
   - สร้างฐานข้อมูล resonance_store + ผู้ใช้ rs_app (รหัสสุ่มใหม่ เก็บใน server-config.json เท่านั้น)
   - ใส่ข้อมูลทั้งหมดจาก resonance_store.dump
   - ตั้งให้ server เปิดเองทุกครั้งที่ log-on Windows และเปิด firewall พอร์ต 8081 (เครือข่าย Domain/Private)
   - เปิดหน้า login ให้
4. Login ด้วย GID เหมือนเดิม (User = GID, Password = GID)
   เครื่องอื่นเข้าได้ที่  http://<IP ของเครื่องใหม่>:8081   (หน้าจอ DONE จะบอก IP)

ถ้าติดปัญหา
-----------
- ตัวติดตั้งไม่ทับของเดิม: ถ้าเครื่องใหม่มี C:\ResonanceStore2027 หรือฐานข้อมูล resonance_store อยู่แล้ว
  มันจะหยุดโดยไม่แก้อะไร
- ดูรายละเอียดใน install_log.txt (สร้างข้างไฟล์นี้หลังรัน) แล้วส่งให้ผู้ดูแลระบบ
- เครื่องอื่นเข้าไม่ได้: ต้องอยู่เครือข่ายเดียวกัน และถ้า Windows ตั้งเครือข่ายเป็น Public
  firewall จะยังกันอยู่ → ให้ IT เปิดขาเข้า TCP 8081 หรือเปลี่ยนเครือข่ายเป็น Private

หลังย้ายเสร็จ (สำคัญ)
--------------------
- ให้ใช้เครื่องใหม่เครื่องเดียว ถ้าเครื่องเดิมยังเปิดอยู่ ข้อมูล 2 เครื่องจะแยกกัน ไม่ซิงก์กัน
- ถ้ามีการแก้ข้อมูลบนเครื่องเดิมหลังวันที่ทำชุดนี้ ต้องทำไฟล์ resonance_store.dump ใหม่ก่อนย้าย
```
