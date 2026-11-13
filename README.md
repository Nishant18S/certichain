# CertiChain — Full Academic Certificate Authentication & Management Prototype

**Stack:** Hyperledger Fabric 2.5, Fabric CA, Node.js 22, Express, JavaScript chaincode, MySQL 8, Bootstrap 5, Chart.js, QRCode.

This source bundle brings together the blockchain certificate lifecycle, PDF integrity verification, persistent off-chain PDF storage, QR verification, admin login, student login/portal, registry, analytics and audit history.

## Important: local blockchain data is not distributable
This ZIP contains source code and SQL schema, not your actual Fabric wallet, private keys, certificates, Docker volumes, channel ledger or PDF records. Your existing network and wallet remain on your computer. Do not run `network.sh down`, delete volumes, or overwrite your wallet. Configure the backend to use your existing wallet and connection profile.

Your previously deployed `certichain` v1.1 sequence 2 contract is compatible with the transaction functions in this package. Do not redeploy it if sequence 2 is already committed.

## Project structure
- `backend/` Express API, Fabric Gateway, authentication, MySQL mapping, PDF storage
- `chaincode/` Fabric JavaScript smart contract
- `frontend/` admin, student, and public verification pages
- `database/schema.sql` MySQL tables
- `docs/` API reference and demo checklist

## 1. Requirements
- Ubuntu / WSL2
- Node.js 18+ (Node 22 recommended)
- Docker Desktop + WSL integration
- Existing Hyperledger Fabric 2.5 test-network with `mychannel`
- MySQL 8.0+

## 2. Install
Extract to `~/workspace/CertiChain_Full_Project`, then:

```bash
cd ~/workspace/CertiChain_Full_Project/backend
npm install
cp .env.example .env
```

Edit `.env` with your MySQL and Fabric paths. Defaults assume:
`~/workspace/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com`
and `backend/wallet`.

To reuse the wallet from your existing project, set `FABRIC_WALLET_PATH` to its absolute path, e.g.
`/home/YOUR_LINUX_USER/workspace/CertiChain/backend/wallet`.
Do not copy private wallet files into a public repository or share them.

## 3. Configure MySQL
Create database and tables:

```bash
mysql -u root -p < ../database/schema.sql
```

Create an admin account (the script hashes the password):

```bash
npm run create-admin -- --email admin@certichain.local --password 'ChangeThisPassword!'
```

The admin account is stored in MySQL. Change the demo password before showing the project. Students can self-register through the Student Portal.

## 4. Fabric network
Your existing network was already started and `certichain` v1.1 sequence 2 was deployed in the prior setup. Verify it is running and keep it intact.

```bash
cd ~/workspace/fabric-samples/test-network
docker ps
```

Do not redeploy or recreate channel if your existing chaincode is committed. For a brand-new network only, follow Hyperledger Fabric test-network setup and use `scripts/deploy-chaincode.sh` after adjusting the path.

## 5. Start
```bash
cd ~/workspace/CertiChain_Full_Project/backend
npm start
```

Open:
- Admin: http://localhost:3000/admin/
- Student: http://localhost:3000/student/
- Public verification: http://localhost:3000/verify/

## 6. Demo flow
1. Login as admin.
2. Issue a PDF certificate and associate it with a student email.
3. Confirm the SHA-256 hash and ledger record.
4. Student registers with the same email and sees assigned certificate.
5. Open QR/public verify link.
6. Upload the original PDF and get `VALID`.
7. Modify the PDF and get `HASH_MISMATCH`.
8. Inspect audit history.
9. Revoke a disposable test certificate; public verification displays `REVOKED`.

## Security / academic prototype limitations
This is a local academic prototype. Before internet/public deployment add HTTPS, secure cookie settings, CSRF protection, rate limiting, account lockout, password reset, email verification, strict CORS, secret manager, file malware scanning, backups, privacy/legal review, and production-grade storage. The `issuer` identity is held by the backend; admin authentication protects the web API but production deployments should use stronger identity-to-issuer controls and audited authorization.

Pagination is applied by the API after retrieving the chaincode range. This is not ledger-level pagination. The QR code is only a URL pointer; authenticity comes from checking the ledger and matching the PDF hash.
