# App Store listing

Paste these into App Store Connect (https://appstoreconnect.apple.com > Apps > NY Transit Live). Change anything you like; the limits Apple enforces are in brackets.

## App information

- **Name** [30 characters]: NY Transit Live
- **Subtitle** [30]: Live subway, bus & rail map
- **Primary category**: Navigation
- **Secondary category**: Travel
- **Content rights**: say it contains third-party content and that you have the right to use it. The MTA publishes its realtime feeds for anyone to use under its [data feed terms](https://www.mta.info/developers). Don't use the MTA's logo or suggest the app is official.
- **Age rating**: answer "None" or "No" to every question. The result is 4+.

## Pricing and availability

- **Price**: Free
- **Availability**: United States (the app only covers New York for now)

## Version information

**Promotional text** [170]:

> See every New York subway train, bus, LIRR and Metro-North train moving on the map, live.

**Description** [4000]:

> NY Transit Live shows where New York's buses and trains are right now, on one live map.
>
> • Subway, MTA buses, LIRR and Metro-North, all on one map, colored by line
> • Zoom in and each dot shows its line
> • Tap a vehicle to see its route, where it is and its next stops with arrival times
> • Follow a train or bus as it moves
> • Show only the lines you ride, and the app remembers them
> • Find yourself on the map to see what's coming nearby
> • Light and dark map, following your phone
>
> Bus positions come from GPS. Subway trains don't report GPS, so their positions are worked out from the MTA's live arrival times and the real track shapes, and are marked as estimated.
>
> No account, no ads, no tracking.
>
> Data comes from the MTA's public realtime feeds. NY Transit Live is not made by or affiliated with the MTA.

**Keywords** [100, commas, no spaces needed]:

> nyc,subway,bus,train,lirr,metro north,transit,tracker,live,realtime,commute,new york,map

**Support URL**: https://transit-tracker-vbfs.onrender.com

**Privacy policy URL**: https://transit-tracker-vbfs.onrender.com/privacy.html

Before you submit, replace both `CONTACT_EMAIL`s in `web/public/privacy.html` with the email people should write to, and push, so the page Apple checks has a way to reach you.

**Copyright**: 2026 your full name

## App privacy

Click **Get Started** under App Privacy and answer **No, we do not collect data from this app**. That's true: there are no accounts or analytics, and the location never leaves the phone. The label then reads "Data Not Collected".

## Screenshots

Apple needs at least one iPhone screenshot at the **6.9-inch** size: 1320 × 2868 or 1290 × 2796 pixels, portrait. Up to 10 are allowed; 3 to 5 is plenty. Good ones:

1. Midtown Manhattan zoomed in, with labelled dots
2. A tapped subway train with its next stops
3. The Lines sheet with a few lines chosen
4. The dark map at night

Take them on your iPhone in the TestFlight build (press the side button and volume up together). If your iPhone isn't a Pro Max or Plus, its screenshots are a different size: send them to me and I'll resize them to fit.

The app runs on iPad too, so Apple also needs at least one iPad screenshot at the **13-inch** size: 2064 × 2752 or 2048 × 2732 pixels (portrait), or the same turned sideways. On an iPad the lines and panels sit in a column down the left of the map, so a sideways shot shows the most map. Take them on an iPad in the TestFlight build (top button and volume up together); if your iPad is a smaller one, send them to me and I'll resize them. With no iPad, Xcode's iPad simulator on a Mac works too.

## Notes for the reviewer

Under **App Review Information**, untick "Sign-in required" and paste:

> No account is needed. The app opens on New York City and shows live subway trains, buses, LIRR and Metro-North trains from the MTA's public realtime feeds. Tap any dot to see that vehicle's route and next stops, and tap Follow to follow it. Use the chips at the top to show only some kinds of vehicle, or Lines to pick specific lines. Location is only used when you tap the location button, to show where you are on the map.

Also fill in your name, phone number and email there. Apple only uses them to contact you about the review.
