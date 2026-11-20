# RadioTV2028

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Remixed using [OMGithub.com](https://go.ondev.store/).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://go.ondev.store/yazeedmustafa57-bit/RadioTV2028)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/yazeedmustafa57-bit/RadioTV2028)

- 🎮 [Open the project](https://go.ondev.store/yazeedmustafa57-bit/RadioTV2028).
- ✨ [Remix this project](https://go.ondev.store/yazeedmustafa57-bit/RadioTV2028?remix=1).
- 💻 [Explore the source](https://github.com/yazeedmustafa57-bit/RadioTV2028).
- 🛠️ [Check build runs](https://github.com/yazeedmustafa57-bit/RadioTV2028/actions).
- 🐛 [Report an issue](https://github.com/yazeedmustafa57-bit/RadioTV2028/issues).
- 👤 [Explore the creator's projects](https://go.ondev.store/yazeedmustafa57-bit).
- 🌍 [Create with OMGithub](https://go.ondev.store/).
- 🧬 [Explore the remix source](https://github.com/yazeedmustafa57-bit/RadioTV2028).
<!-- omgithub:readme:end -->

## Firebase einrichten (gemeinsame Konfiguration & Admin-Login)

Ohne Firebase funktionieren Änderungen nur lokal im Browser. Für öffentliche, besucherübergreifende Einstellungen ist Firebase nötig.

1. Erstelle ein Projekt unter [Firebase Console](https://console.firebase.google.com/) und füge eine Web-App hinzu. Kopiere die Web-App-Konfiguration.
2. Öffne **Authentication → Sign-in method**, aktiviere **Email/Password** und lege unter **Users** den Admin-Benutzer mit E-Mail und Passwort an. Es gibt im Projekt absichtlich keine öffentliche Registrierungsfunktion.
3. Öffne **Firestore Database** und erstelle eine Datenbank (Produktionsmodus ist empfohlen). Öffne danach **Authentication → Users**, kopiere die UID des Admin-Benutzers.
4. Füge in **Firestore → Rules** die folgenden Regeln ein und ersetze `ADMIN_UID_HIER_EINTRAGEN` durch genau diese UID:

   ```text
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /site/config {
         allow read: if true;
         allow create, update, delete: if request.auth != null
           && request.auth.uid == 'ADMIN_UID_HIER_EINTRAGEN';
       }
       match /site/live {
         allow read: if true;
         allow create, update, delete: if request.auth != null
           && request.auth.uid == 'ADMIN_UID_HIER_EINTRAGEN';
       }
     }
   }
   ```

   Veröffentliche die Regeln. Besucher können dann die Konfiguration lesen, aber ausschließlich der erlaubte Admin kann sie ändern.
5. In `index.html`, ersetze `window.FIREBASE_CONFIG=null;` mit der Web-App-Konfiguration, zum Beispiel:

   ```js
   window.FIREBASE_CONFIG={
     apiKey:'DEIN_API_KEY',
     authDomain:'DEIN_PROJEKT.firebaseapp.com',
     projectId:'DEIN_PROJEKT',
     appId:'DEINE_APP_ID'
   };
   ```

6. Lade die Seite über HTTPS neu. Öffne **Admin**, melde dich mit der angelegten E-Mail und dem Passwort an und speichere eine Einstellung. Prüfe danach in Firestore das Dokument `site/config`.

**Sicherheit:** Die Firebase-Web-Konfiguration ist öffentlich und kein Geheimnis. Sicherheit kommt hier von Firebase Authentication plus den Firestore-Regeln mit der Admin-UID. Füge keine permissiven `allow write: if true`-Regeln hinzu. Der Passwort-Demozugang ist nur auf `localhost` verfügbar und wird auf öffentlichen Hosts nicht akzeptiert. Wenn Firebase noch nicht konfiguriert ist, gibt es keine gemeinsame Speicherung und keinen Admin-Login.

**Medien:** Streams und Einbettungen hängen von den jeweiligen Anbietern ab. HTTPS-Seiten benötigen HTTPS-Medienlinks; HLS-Quellen benötigen gegebenenfalls CORS. Browser können außerdem Autoplay blockieren, bis ein Besucher Play drückt.
