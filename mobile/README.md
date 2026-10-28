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

1. On your iPhone, install **Expo Go** from the App Store.
2. On your PC, in PowerShell:

   ```powershell
   cd transit-tracker
   git checkout main
   git pull
   cd mobile
   npm install
   npx expo start
   ```

3. A QR code appears in PowerShell. Open the iPhone **Camera**, point it at the code, and tap the banner. The app opens inside Expo Go.

Your phone and PC need to be on the same Wi-Fi. If the phone can't connect (Windows Firewall often blocks it), stop it with Ctrl+C and run `npx expo start --tunnel` instead.

The app uses the live server at `https://transit-tracker-vbfs.onrender.com`. If it was asleep, the first vehicles can take a minute to appear. Any change you save in `App.tsx` shows up on the phone straight away.

## 2. Make the accounts (once)

1. **Apple Developer Program.** Go to https://developer.apple.com/programs/enroll/, sign in with your Apple ID (it needs two-factor authentication on), enroll as an **Individual**, and pay the $99. Approval usually takes a day or two; you'll get an email. As an individual, your own name appears on the App Store as the seller.
2. **Expo.** Sign up at https://expo.dev/signup.
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

## How it's put together

- `App.tsx`: the map screen. Vehicles appear once you zoom in to about a few neighborhoods (the website shows them a little further out), and at most 300 are drawn at once, nearest the middle of the screen first, so the map stays smooth.
- `src/`: the vehicle panel, the Lines sheet, the server calls and map helpers.
- Colors, names, arrival times and the Lines groups come from the website's `web/src/vehicles.ts`, so both stay the same.
- The map is light or dark following the phone's own setting.
- To point the app at another server, set `EXPO_PUBLIC_API_URL`, for example `$env:EXPO_PUBLIC_API_URL="http://192.168.1.20:3000"; npx expo start` to use the server running on your PC.

Check the code with `npm run typecheck`.
