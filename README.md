# Resource Allocation & Help Desk Hub

CS763 Secure Software Development (Boston University MET), Fall 2026 — individual project, Domain 2 of the Project Portal.

A cloud-native backend service that manages software license keys and cloud credit vouchers for student project teams, with usage quotas, automatic expiration, and a help desk for resource requests and support tickets.

- **Specification:** [spec.md](spec.md)
- **Stack:** Node.js + TypeScript (Express), PostgreSQL, Docker
- **Pipeline:** GitHub Actions with Trivy, Semgrep and SonarQube Cloud

## PA1 deliverables

| Deliverable | File |
|---|---|
| Service specification | [spec.md](spec.md) |
| Agent environment | [Agent_environment.md](Agent_environment.md) |
| Prompt test log | [Prompt_test_log.md](Prompt_test_log.md) |
| DevSecOps pipeline | [.github/workflows/devsecops.yml](.github/workflows/devsecops.yml), [sonar-project.properties](sonar-project.properties) |
| Docker | [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml), [.env.example](.env.example) |
| Pipeline execution log | [pipeline-logs/](pipeline-logs/README.md) |

## Running locally

```bash
cp .env.example .env          # placeholder values; adjust if needed
docker compose up --build     # db + migrate job + app
curl localhost:3000/api/v1/health
```

Without Docker for the app: start only the database with `docker compose up -d db`, then `npm ci && npm run dev`.

| Script | Purpose |
|---|---|
| `npm run dev` | Run with reload (tsx) |
| `npm run build` | Generate Prisma client and compile to `dist/` |
| `npm start` | Run the compiled app |
| `npm test` | Vitest + Supertest |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Create/apply a migration in development |
