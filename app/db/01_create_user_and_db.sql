/* =====================================================================
   RESONANCE STORE · step 1 of 2 · create the login role and the database
   pgAdmin 4: connect as "postgres" → right-click database "postgres" → Query Tool → paste / open this file
   1. change the password on the line below (keep the quotes) and write it down for server-config.json
   2. Execute (F5)
   ===================================================================== */
CREATE ROLE rs_app LOGIN PASSWORD 'เปลี่ยนเป็นรหัสที่ปลอดภัย';
CREATE DATABASE resonance_store OWNER rs_app ENCODING 'UTF8' TEMPLATE template0;

/* step 2: refresh the server tree (F5) → database "resonance_store" → Query Tool →
   run the line below first, then open db/schema.sql and Execute (F5), so every table belongs to rs_app:

   SET ROLE rs_app;
*/
