# beat4beat-webapp

Simple Beat for Beat-style moderator board.

## Run locally

Start the built-in web server:

```bash
npm start
```

Use a custom port:

```bash
node server.js --port 8080
```

Or with an environment variable:

```bash
PORT=8080 npm start
```

## Persistence

The app now stores data on the server in the local `data/` folder:

- `data/current-game.json`: the live game that auto-saves while you edit or play
- `data/saved-games.json`: named saved games you can load later from Admin
