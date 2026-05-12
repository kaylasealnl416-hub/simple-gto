# simple-gto Project Instructions

## Project Identity

- Local project directory: `/Users/sunda/Documents/AiCodingProjects/simple-gto`
- GitHub repository: `kaylasealnl416-hub/simple-gto`
- Default branch: `main`
- Product name: `简单GTO`

## Scope

This is an independent project under `/Users/sunda/Documents/AiCodingProjects`.

The app is a private Texas Hold'em 8-max cash-game training tool. Keep V1 constraints stable unless the user explicitly approves a product change:

- 8-max table
- blinds 10/20
- 200BB buy-in
- mobile portrait first
- preflop strategy table only

## Local Workflow

- Use Git branches or worktrees for changes.
- Keep business logic changes separate from migration/docs changes.
- Run `bun run verify` before delivery.
- Use `bun run serve` for local preview.
- On Mac mini, `bash scripts/launch-local-mac.sh` opens the local app.

## Notes

- `scripts/launch-local.ps1` is the legacy Windows launcher.
- `scripts/launch-local-mac.sh` is the Mac mini launcher.
- Project-specific durable notes belong in `memory/`.
