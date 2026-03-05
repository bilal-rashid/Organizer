# Clothes Organizer (Expo)

Offline React Native Expo app to organize clothes by bag:

- Create a bag.
- Add multiple suit photos from the phone gallery (copied to app storage).
- Generate and print/share a QR PDF label for each bag.
- Later scan that QR to instantly see all suit photos in that bag.

## Run

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start Expo:
   ```bash
   npm run start
   ```

## Notes

- Data is fully local-only on the phone (`AsyncStorage` + `expo-file-system`).
- No cloud or internet API is used by the app logic.
