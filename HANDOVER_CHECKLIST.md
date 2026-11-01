# Hand-over checklist

Goal: the Resonance Store keeps working, and can be changed by the Dev team, even if its original author is no longer with the company.

Tick each line and write who and when.

## 1. Code is owned by the team, not a person
- [ ] This folder is in the company Git (GitHub / Azure DevOps / GitLab), or in a team SharePoint library if there is no Git. **Not** on a personal PC or personal OneDrive.
- [ ] At least **2 Dev team members** have write access. Names: ________ / ________
- [ ] Every change goes through the release steps in `docs/CHANGE_GUIDE.md` and gets a line in `CHANGELOG.md`.

## 2. Server is owned by the team
- [ ] `server.js` runs on a company server under a **service account** (not a personal login), as a Windows service (NSSM) or similar, so it restarts after a reboot.
- [ ] It is behind https (reverse proxy). See `docs/DEPLOY.md`.
- [ ] At least 2 people can log in to the server and restart the service. Names: ________ / ________

## 3. Backups survive people leaving
- [ ] `backupDir` in `server-config.json` points to a **team** SharePoint / OneDrive library or a network share, not a personal OneDrive.
- [ ] Someone other than the author has done one **test restore** (`docs/OPERATIONS.md`). Who / date: ________

## 4. Knowledge
- [ ] One walk-through session: author → Dev team (architecture, how a change flows, how to release). Date: ________
- [ ] One session: author → lab key user (Zone Setup, Hold rules, import files, printing the paper map). Key user: ________
- [ ] The lab's Standard Work (WI) points to the server URL, not to a file on someone's PC.

## 5. Remove single-person ties
- [ ] `HSA_TEAM_EMAILS` (`app.js` CONFIG) on the **deployed** copy points to an active team Teams chat. It is kept empty in the repository.
- [ ] `README.md`: "Owner after hand-over" is filled in.
- [ ] `docs/OPERATIONS.md`: the "Who to call" section is filled in.

## 6. Known next steps (not started)
- QR scanning (labels, shelf scan, scan before scrap): the code exists but is **waiting for a scanner that meets clean-room rules**.
- Split `app.js` into smaller files per section (see `docs/CODE_MAP.md`).
