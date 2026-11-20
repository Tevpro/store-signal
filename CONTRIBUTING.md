# Contributing to StoreSignal

Start with [AGENTS.md](AGENTS.md), [requirements](docs/requirements.md), [architecture](docs/architecture.md), and [coding standards](docs/coding-standards.md). Put reusable/nontrivial models, types and schemas in separate descriptively named files; name implementation files for the behavior they contain rather than only the API version (`v1/` may be a folder). Simple one-off output types may remain local. Choose an unclaimed GitHub issue; link the matching Plane card for internal work. Discuss contract changes before implementation. Use one scoped PR targeting main and include actual test output, security/privacy considerations, and rollback. No screenshots, customer data, account keys, unlicensed copied review corpora or opaque AI verdict fixtures.

## License and contribution rights

Keith recorded **Apache-2.0** (SPDX identifier `Apache-2.0`) as the current choice for Tevpro-owned project code; see [LICENSE](LICENSE) and the [decision record](docs/decisions.md). The licensing PR is draft/unmerged pending independent approval and verification of ownership/authority and third-party provenance. A draft PR or public repo is not an effective grant on `main`; check the merged tree and rights before relying on one. This software license does not cover third-party provider data or Tevpro/StoreSignal marks.

Every contribution must be submitted under terms compatible with the project's Apache-2.0 license and must have a clear provenance. You must have the right to submit it, including any rights needed from your employer or other rights holders. Before including third-party code or assets, identify their origin, exact version/license, attribution/notice obligations, and compatibility; obtain maintainer review. Do not copy material from an unknown or incompatible source. Dependencies are not automatically relicensed by this repository's LICENSE; assess each dependency's own terms, including extension and Worker/Node distribution implications. Provider search results, Google/Reddit content, and any other third-party datasets require separate source-specific permission and retention/display review. No external contribution or third-party code is accepted without maintainer verification of applicable rights and compatibility.

## DCO 1.1 sign-off

We require the [Developer Certificate of Origin version 1.1](https://developercertificate.org/) for each commit. By adding a sign-off, you certify the DCO's right-to-contribute/provenance conditions and agree the contribution and sign-off are public records. Read the full DCO before signing; it is **not** a copyright assignment or a blanket grant for future dual licensing.

Add a sign-off with `git commit -s -m "docs: describe change"` (or `git commit --amend -s` for your own latest commit). It creates a commit trailer such as `Signed-off-by: Your Name <your-email@example.com>`. Use your own name and an email you control; the sign-off identity must match the commit author or have an explained authorized contribution path. Do not sign for another contributor without their authorization. For multiple commits, sign each commit individually; a PR-body signature is not a substitute. Maintainers will ask for corrected sign-offs or provenance before accepting a PR.

If you need an alternate license or want to submit material you cannot license as required, discuss it in an issue **before** opening a code PR. Any future relicensing or dual-license program would require separately reviewed contributor rights; DCO 1.1 does not provide them.

For brand references and fork naming, see the separate [trademark policy](TRADEMARKS.md). No part of the DCO or software license grants a brand endorsement.
