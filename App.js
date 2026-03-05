import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';

const STORAGE_KEY = 'bags:v1';

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureDirectory(path) {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

function getFileName(uri) {
  return uri.split('/').pop() || `${makeId()}.jpg`;
}

async function copyPhotoToAppStorage(bagId, sourceUri) {
  const base = `${FileSystem.documentDirectory}bags/${bagId}`;
  await ensureDirectory(base);
  const destination = `${base}/${getFileName(sourceUri)}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destination });
  return destination;
}

function Button({ title, onPress, type = 'primary', disabled = false }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, styles[`button_${type}`], disabled && styles.button_disabled]}
    >
      <Text style={[styles.buttonText, type === 'secondary' && styles.buttonTextSecondary]}>{title}</Text>
    </Pressable>
  );
}

export default function App() {
  const [bags, setBags] = useState([]);
  const [activeTab, setActiveTab] = useState('bags');
  const [newBagName, setNewBagName] = useState('');
  const [selectedBagId, setSelectedBagId] = useState(null);
  const [viewerBag, setViewerBag] = useState(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannedBag, setScannedBag] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();

  const qrRef = useRef(null);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        setBags(JSON.parse(raw));
      }
    })();
  }, []);

  const selectedBag = useMemo(() => bags.find((b) => b.id === selectedBagId) || null, [bags, selectedBagId]);

  async function saveBags(next) {
    setBags(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function createBag() {
    if (!newBagName.trim()) {
      Alert.alert('Bag name needed', 'Please add a name for this bag.');
      return;
    }
    const bag = {
      id: makeId(),
      name: newBagName.trim(),
      createdAt: new Date().toISOString(),
      photos: [],
    };
    const next = [bag, ...bags];
    await saveBags(next);
    setNewBagName('');
    setSelectedBagId(bag.id);
    Alert.alert('Bag created', 'Now add suit photos to this bag.');
  }

  async function addPhotosToSelectedBag() {
    if (!selectedBag) {
      Alert.alert('No bag selected', 'Create or select a bag first.');
      return;
    }

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission required', 'Photo library access is required to save suit photos.');
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: 25,
    });

    if (pickerResult.canceled) return;

    const copied = [];
    for (const asset of pickerResult.assets) {
      const localUri = await copyPhotoToAppStorage(selectedBag.id, asset.uri);
      copied.push({ id: makeId(), uri: localUri, addedAt: new Date().toISOString() });
    }

    const next = bags.map((bag) =>
      bag.id === selectedBag.id
        ? {
            ...bag,
            photos: [...bag.photos, ...copied],
          }
        : bag
    );

    await saveBags(next);
  }

  function getQrPayload(bag) {
    return JSON.stringify({ bagId: bag.id });
  }

  async function generatePdfForBag(bag) {
    if (!bag.photos.length) {
      Alert.alert('No photos', 'Add photos before generating QR PDF.');
      return;
    }

    if (!qrRef.current) {
      Alert.alert('QR unavailable', 'Please try again.');
      return;
    }

    const base64Png = await new Promise((resolve) => qrRef.current.toDataURL(resolve));
    const qrImageTag = `<img src="data:image/png;base64,${base64Png}" width="250" height="250" />`;
    const html = `
      <html>
        <body style="font-family: Arial; padding: 24px;">
          <h1>Bag Label: ${bag.name}</h1>
          <p><strong>Total suits:</strong> ${bag.photos.length}</p>
          <p>Print this page and attach the QR code to your bag.</p>
          <div style="margin-top: 20px;">${qrImageTag}</div>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">Payload: ${getQrPayload(bag)}</p>
        </body>
      </html>
    `;

    const file = await Print.printToFileAsync({ html });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(file.uri, {
        UTI: '.pdf',
        mimeType: 'application/pdf',
      });
    } else {
      Alert.alert('PDF generated', `Saved at: ${file.uri}`);
    }
  }

  function renderBagCard({ item }) {
    const selected = item.id === selectedBagId;
    return (
      <Pressable style={[styles.card, selected && styles.cardSelected]} onPress={() => setSelectedBagId(item.id)}>
        <Text style={styles.cardTitle}>{item.name}</Text>
        <Text style={styles.cardMeta}>{item.photos.length} photos</Text>
        <Button title="View photos" onPress={() => setViewerBag(item)} type="secondary" />
      </Pressable>
    );
  }

  function handleQrScanned({ data }) {
    try {
      const payload = JSON.parse(data);
      const bag = bags.find((x) => x.id === payload.bagId);
      if (!bag) {
        Alert.alert('Bag not found', 'This QR does not match a saved bag on this phone.');
      } else {
        setScannedBag(bag);
        setScannerVisible(false);
      }
    } catch {
      Alert.alert('Invalid QR', 'This QR code is not from the Organizer app.');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Clothes Organizer</Text>
        <Text style={styles.headerSub}>Offline bag tracker with QR labels</Text>
      </View>

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, activeTab === 'bags' && styles.tabActive]} onPress={() => setActiveTab('bags')}>
          <Text style={[styles.tabText, activeTab === 'bags' && styles.tabTextActive]}>Manage Bags</Text>
        </Pressable>
        <Pressable style={[styles.tab, activeTab === 'scan' && styles.tabActive]} onPress={() => setActiveTab('scan')}>
          <Text style={[styles.tabText, activeTab === 'scan' && styles.tabTextActive]}>Scan QR</Text>
        </Pressable>
      </View>

      {activeTab === 'bags' ? (
        <ScrollView contentContainerStyle={styles.section}>
          <Text style={styles.sectionTitle}>Create bag</Text>
          <TextInput
            style={styles.input}
            placeholder="Bag name (e.g. Wedding Suits Bag 1)"
            value={newBagName}
            onChangeText={setNewBagName}
          />
          <Button title="Create Bag" onPress={createBag} />

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Your bags</Text>
          <FlatList
            data={bags}
            renderItem={renderBagCard}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            ListEmptyComponent={<Text style={styles.muted}>No bags yet. Create your first one.</Text>}
          />

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Selected bag actions</Text>
          <Text style={styles.muted}>{selectedBag ? `${selectedBag.name}` : 'No bag selected'}</Text>
          <Button title="Add suit photos" onPress={addPhotosToSelectedBag} disabled={!selectedBag} />

          {selectedBag && (
            <View style={styles.qrBlock}>
              <QRCode value={getQrPayload(selectedBag)} size={180} getRef={(c) => (qrRef.current = c)} />
              <Text style={styles.muted}>QR for {selectedBag.name}</Text>
              <Button title="Generate QR PDF" onPress={() => generatePdfForBag(selectedBag)} />
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scan a bag label</Text>
          <Text style={styles.muted}>Scan the printed QR to instantly see what suits are inside that bag.</Text>
          <Button title="Open scanner" onPress={() => setScannerVisible(true)} />

          {scannedBag && (
            <View style={styles.scanResult}>
              <Text style={styles.cardTitle}>{scannedBag.name}</Text>
              <Text style={styles.cardMeta}>{scannedBag.photos.length} suit photos</Text>
              <Button title="Open bag gallery" onPress={() => setViewerBag(scannedBag)} type="secondary" />
            </View>
          )}
        </View>
      )}

      <Modal visible={!!viewerBag} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.headerTitle}>{viewerBag?.name}</Text>
            <Button title="Close" onPress={() => setViewerBag(null)} type="secondary" />
          </View>
          <FlatList
            data={viewerBag?.photos || []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => <Image source={{ uri: item.uri }} style={styles.photo} />}
            ListEmptyComponent={<Text style={styles.muted}>No photos in this bag.</Text>}
          />
        </SafeAreaView>
      </Modal>

      <Modal visible={scannerVisible} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.headerTitle}>Scan QR</Text>
            <Button title="Close" onPress={() => setScannerVisible(false)} type="secondary" />
          </View>
          {!permission?.granted ? (
            <View style={styles.section}>
              <Text style={styles.muted}>Camera permission is required.</Text>
              <Button title="Grant camera permission" onPress={requestPermission} />
            </View>
          ) : (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleQrScanned}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  headerSub: { fontSize: 13, color: '#475569' },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabActive: { backgroundColor: '#0f172a' },
  tabText: { color: '#0f172a', fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  section: { padding: 16, gap: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginVertical: 4,
  },
  button_primary: { backgroundColor: '#0ea5e9' },
  button_secondary: { backgroundColor: '#e2e8f0' },
  button_disabled: { opacity: 0.45 },
  buttonText: { color: '#fff', fontWeight: '700' },
  buttonTextSecondary: { color: '#0f172a' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 8,
    gap: 6,
  },
  cardSelected: { borderColor: '#0ea5e9', borderWidth: 2 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  cardMeta: { fontSize: 13, color: '#475569' },
  muted: { color: '#64748b' },
  qrBlock: {
    marginTop: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalContainer: { flex: 1, backgroundColor: '#f8fafc' },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  photo: {
    width: '100%',
    height: 260,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#e2e8f0',
  },
  scanResult: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
  },
});
