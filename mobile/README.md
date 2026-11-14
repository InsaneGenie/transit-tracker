# NY Transit Live for iPhone

The iPhone app: the same live buses and trains as the website, on Apple's own map. It's built with [Expo](https://expo.dev) (React Native) and gets its data from the website's server on Render, so nothing else needs to be hosted.

Expo's cloud service, **EAS**, builds and signs the app on its own Macs and uploads it to Apple, so everything below works from Windows and PowerShell. You never need a Mac or Xcode.

## What it costs

| What | Cost | Needed for |
| --- | --- | --- |
| Expo Go app on your iPhone | Free | Trying the app before paying anything |
| [Expo account](https://expo.dev/signup) | Free (the free plan includes a monthly allowance of cloud builds, plenty for this) | Building the real app |
| [Apple Developer Program](https://developer.apple.com/programs/enroll/) | $99 a year | TestFlight and the App Store |
| Render server | Free, or $7 a month to never sleep | The live data the app shows |

## 1. Try it on your iPhone (free, about 10 minutes)

1. Make a free Expo account at https://expo.dev/signup.
2. On your iPhone, install **Expo Go** from the App Store, open it, and log in with that account.
3. On your PC, in PowerShell:

   ```powershell
   cd transit-tracker
   git checkout main
   git pull
   cd mobile
   npm install
   npx expo login
   npx expo start
   ```

   `npx expo login` is only needed the first time. Expo Go won't open the app unless the same account is signed in on both the PC and the phone.

4. A QR code appears in PowerShell. Open the iPhone **Camera**, point it at the code, and tap the banner. The app opens inside Expo Go.

Your phone and PC need to be on the same Wi-Fi. If the phone can't connect (Windows Firewall often blocks it), stop it with Ctrl+C and run `npx expo start --tunnel` instead.

The app uses the live server at `https://transit-tracker-vbfs.onrender.com`. If it was asleep, the first vehicles can take a minute to appear. Any change you save in `App.tsx` shows up on the phone straight away.

## 2. Make the accounts (once)

1. **Apple Developer Program.** Go to https://developer.apple.com/programs/enroll/, sign in with your Apple ID (it needs two-factor authentication on), enroll as an **Individual**, and pay the $99. Approval usually takes a day or two; you'll get an email. As an individual, your own name appears on the App Store as the seller.
2. **Expo.** Use the account from step 1.
3. In PowerShell:

   ```powershell
   npm install -g eas-cli
   eas login
   cd transit-tracker\mobile
   eas init
   ```

   `eas init` links this folder to your Expo account and adds a project id to `app.json`. Commit that change (`git commit -am "Link the app to Expo"` and `git push`).

## 3. Build it and send it to Apple

```powershell
cd transit-tracker\mobile
eas build --platform ios --profile production --auto-submit
```

- It asks you to **log in to your Apple account**. Say yes: EAS then creates the signing certificate, the provisioning profile and the app's ID (`com.insanegenie.nytransitlive`) for you. Accept the defaults whenever it offers to generate something.
- It may ask for the app's name on the App Store. `NY Transit Live` is the default; if Apple says the name is taken, pick another such as `NY Transit Live Map` and change `name` in `app.json` to match.
- The build runs on Expo's Macs. On the free plan it can wait in a queue first; the whole thing usually takes 15 to 45 minutes. You can close PowerShell and watch it on https://expo.dev.
- `--auto-submit` uploads the finished build to **App Store Connect**, Apple's site for managing your apps.

Every later build gets the next build number automatically. To release a new version to the store, raise `version` in `app.json` (for example to `1.1.0`) and run the same command.

## 4. Test the real app with TestFlight

1. Open https://appstoreconnect.apple.com > **Apps** > NY Transit Live > **TestFlight**. Apple takes 10 to 30 minutes to process a new build.
2. Under **Internal Testing**, create a group, add yourself, and add the build.
3. Install **TestFlight** from the App Store on your iPhone, open the invite, and install NY Transit Live. This is exactly the app the store will get.

## 5. Fill in the App Store listing and submit

Everything to paste is in [APP_STORE.md](APP_STORE.md): the description, keywords, review notes, privacy answers and screenshot sizes. In App Store Connect, open the app's **App Store** tab, fill it in, pick the build, and click **Add for Review**, then **Submit**. Review usually takes one to three days. If Apple rejects it, they say why in App Store Connect; send me the message and I'll fix it.

**Before you submit, keep the server awake.** A free Render server sleeps after 15 minutes. If the reviewer opens the app to an empty map while it wakes up, they may reject it as broken. Add the free [UptimeRobot](https://uptimerobot.com) monitor described in the main README, or switch the Render service to the $7 Starter plan.

## Widgets and the Lock Screen

The app has a Home Screen and Lock Screen widget, and can follow a train or bus on the Lock Screen and in the Dynamic Island (a Live Activity). They need the real app from TestFlight or the App Store: **Expo Go can't show them**, so in Expo Go the buttons for them are hidden.

- **Widget.** Open a station (tap a train, then a station in its list, or a station on the map) and tap **Add to widget**. Then hold an empty spot on the Home Screen, tap **Edit**, **Add Widget**, and pick **NY Transit Live**. It comes small, medium, and in three Lock Screen sizes. With more than one station saved, hold the widget, tap **Edit Widget** and pick which one it shows. A widget can't go online by itself, so each time the app is open it hands the widget the next hour of arrivals and the widget counts them down; it says "Open the app for new times" when they run out.
- **Live Activity.** Tap a train or bus and tap **Track on Lock Screen**. It follows it to the station you picked, or to the end of its trip, with a countdown and a progress bar that run on their own. It ends a couple of minutes after the vehicle leaves the station. Tapping it opens the app on that vehicle.

### What you need to do for them

1. **Build as usual.** `eas build --platform ios --profile production --auto-submit`. The first build after this change adds a second part to the app (the widget, `com.insanegenie.nytransitlive.ExpoWidgetsTarget`), an App Group (`group.com.insanegenie.nytransitlive`) and Push Notifications. When EAS asks to set up credentials or capabilities for them, say **yes** and let it log in to your Apple account; it does the rest.
2. **Optional, so the Lock Screen keeps updating while the app is closed.** Without this the Live Activity is still updated while the app is open, and keeps counting down when it isn't. With it, the server sends it fresh positions and times.
   1. On https://developer.apple.com/account/resources/authkeys/list click **+**, name it "Live Activities", tick **Apple Push Notifications service (APNs)** (if it asks which environment, pick **Sandbox & Production**), then **Continue**, **Register**, then **Download**. You can download the `.p8` file only once, so keep it somewhere safe. Note the **Key ID** on that page.
   2. Your **Team ID** is at the top right of the developer site (or under **Membership details**).
   3. In Render, open the `transit-tracker` service, **Environment**, **Add Environment Variable**, and add three: `APNS_KEY` (open the `.p8` file in Notepad and paste all of it, including the `BEGIN` and `END` lines), `APNS_KEY_ID` and `APNS_TEAM_ID`. Save; Render redeploys.
   4. Check https://transit-tracker-vbfs.onrender.com/api/health: it should say `"liveActivities":{"enabled":true,...}`.

   A free Render server goes to sleep after 15 minutes with no visitors, and then it can't send updates either, so this works best with the server kept awake.

## How it's put together

- `App.tsx`: the map screen. Vehicles appear once you zoom in to about a few neighborhoods (the website shows them a little further out), and at most 300 are drawn at once, nearest the middle of the screen first, so the map stays smooth.
- `src/`: the vehicle panel, the Lines sheet, the server calls and map helpers.
- `src/widgets/`: the widget and the Live Activity. They're drawn with Expo UI (SwiftUI) by [`expo-widgets`](https://docs.expo.dev/versions/latest/sdk/widgets/) and run apart from the app, so each one can only use what's inside its own function. What they show is worked out in `web/src/widgetTimeline.ts` and `web/src/tracking.ts`; the server uses the latter too when it pushes Live Activity updates (`server/src/liveActivities.ts`).
- Colors, names, arrival times and the Lines groups come from the website's `web/src/vehicles.ts`, so both stay the same.
- The map is light or dark following the phone's own setting.
- To point the app at another server, set `EXPO_PUBLIC_API_URL`, for example `$env:EXPO_PUBLIC_API_URL="http://192.168.1.20:3000"; npx expo start` to use the server running on your PC.

Check the code with `npm run typecheck`.
