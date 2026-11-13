# API quick reference

- `GET /api/health` — service status.
- `POST /api/auth/register` — student registration (`fullName,email,password,studentId?`).
- `POST /api/auth/login` — login (`email,password`).
- `POST /api/auth/logout` — destroy session.
- `GET /api/auth/me` — current session user.
- `POST /api/certificates/issue` — admin only; multipart `certificateId,studentEmail,title,institution,certificate`.
- `POST /api/certificates/verify` — multipart `certificateId,certificate`; no login required.
- `POST /api/certificates/revoke` — admin only; JSON `certificateId`.
- `GET /api/certificates` — admin only; `search,status,page,limit`.
- `GET /api/dashboard/stats` — admin only.
- `GET /api/certificates/:id/history` — admin only; Fabric key history.
- `GET /api/certificates/:id/document` — authenticated session.
- `GET /api/student/certificates` — student only.
- `GET /api/public/verify/:id` — public ledger status.
- `GET /api/public/qr/:id` — PNG QR code.
- `GET /api/admin/audit` — admin only application audit events.
- `GET /api/admin/analytics` — admin only chart data.
