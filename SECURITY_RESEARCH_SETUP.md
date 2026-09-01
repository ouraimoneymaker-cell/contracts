# Security Research Setup

This branch is reserved for authorized Strata bug-bounty research.

Rules:
- Keep testing local or in permitted forked environments.
- Do not send exploit transactions to live deployments or real user funds.
- Treat existing audit findings and committed PoCs as known issues until proven otherwise.
- Do not publish unpublished vulnerability details in this public fork.

Current baseline:
- Upstream branch: `tranches`
- Research branch: `security-research`
- Research focus begins with in-scope accounting, rounding, unit-conversion, and ERC-4626 invariant analysis.
