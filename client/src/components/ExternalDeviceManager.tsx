import React, { useState, useEffect } from 'react';
import { 
  Bluetooth, 
  Usb, 
  Plus, 
  Trash2, 
  Smartphone, 
  HardDrive, 
  Search, 
  Printer, 
  Scan, 
  CheckCircle2, 
  Settings, 
  Loader2 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDevices } from '@/contexts/DeviceContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import api from '@/lib/api';
import { LocalizedContent } from '@/contexts/LanguageContext';

type ReceiptSettings = {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  headerNote: string;
  footerNote: string;
  autoPrintOnSale: boolean;
  printerDeviceName: string;
  paperWidth: '58mm' | '80mm';
  showDateTime: boolean;
  showStaffName: boolean;
};

const defaultReceiptSettings: ReceiptSettings = {
  storeName: 'SmartPOS+ Store',
  storeAddress: '',
  storePhone: '',
  headerNote: 'Thank you for your purchase!',
  footerNote: 'No refunds without receipt.',
  autoPrintOnSale: false,
  printerDeviceName: '',
  paperWidth: '58mm',
  showDateTime: true,
  showStaffName: true,
};

const ExternalDeviceManager: React.FC = () => {
  const { 
    connectedDevices, 
    availableDevices, 
    isScanning, 
    scanForDevices, 
    selectDevice, 
    setDefaultPrinter,
    disconnectDevice, 
    isUSBSupported, 
    isBluetoothSupported,
    connectUSBDevice,
    connectBluetoothDevice
  } = useDevices();
  const { toast } = useToast();
  const [showReceiptConfig, setShowReceiptConfig] = useState(false);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(defaultReceiptSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const defaultPrinter = connectedDevices.find(d => d.type === 'printer' && d.isDefault);
  const connectedPrinters = connectedDevices.filter(d => d.type === 'printer');
  const availablePrinters = availableDevices.filter(d => d.type === 'printer');

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data: { receipt?: Partial<ReceiptSettings> } = await api.get('/api/settings');
      const merged: ReceiptSettings = { ...defaultReceiptSettings, ...(data.receipt || {}) };
      setReceiptSettings(merged);
    } catch (error) {
      console.error('Error loading receipt settings', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put('/api/settings', { receipt: receiptSettings });
      toast({ title: 'Settings Saved', description: 'Receipt settings have been updated.' });
      setShowReceiptConfig(false);
    } catch (error) {
      toast({ title: 'Save Failed', description: error instanceof Error ? error.message : 'Could not save settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    try {
      await api.post('/api/print/test-receipt', {});
      toast({ title: 'Test Receipt Sent', description: 'Check your connected printer for the test receipt.' });
    } catch (error) {
      toast({ title: 'Test Print Failed', description: error instanceof Error ? error.message : 'Could not send test receipt', variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (showReceiptConfig) {
      loadSettings();
    }
  }, [showReceiptConfig]);

  return (
    <LocalizedContent>
    <div className="space-y-6">
      {/* Printer Setup Section */}
      <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2 dark:text-white">
            <Printer className="w-5 h-5 text-[#FF8882]" />
            Printer Setup
          </CardTitle>
          <CardDescription className="dark:text-gray-400">
            Connect and configure your thermal printer for receipt printing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Connected Status */}
          {defaultPrinter && (
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
              <div>
                <div className="text-sm font-semibold text-green-800 dark:text-green-200">Connected</div>
                <div className="text-sm text-green-700 dark:text-green-300">{defaultPrinter.name} is ready to print receipts</div>
              </div>
            </div>
          )}

          {/* Available Printers List */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Select Printer Device Available</h4>
            <div className="space-y-2">
              {availablePrinters.map((device) => {
                const isConnected = connectedDevices.some(d => d.id === device.id);
                return (
                  <div 
                    key={device.id} 
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                        <Printer className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-medium dark:text-white">{device.name}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-1 uppercase">
                          {device.connection === 'usb' ? <Usb className="w-3 h-3" /> : <Bluetooth className="w-3 h-3" />}
                          {device.connection}
                        </div>
                      </div>
                    </div>
                    {isConnected ? (
                      <Badge variant="default" className="bg-green-600">Connected</Badge>
                    ) : (
                      <Button 
                        onClick={() => selectDevice(device)}
                        className="bg-[#FF8882] hover:bg-[#FF7770] text-white"
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Connect Buttons */}
          <div className="flex flex-wrap gap-2">
            {isUSBSupported && (
              <Button 
                onClick={() => connectUSBDevice('printer')} 
                className="bg-[#FF8882] hover:bg-[#FF7770] text-white"
              >
                <Usb className="w-4 h-4 mr-2" />
                Connect via USB
              </Button>
            )}
            {isBluetoothSupported && (
              <Button 
                onClick={() => connectBluetoothDevice('printer')} 
                className="bg-[#FF8882] hover:bg-[#FF7770] text-white"
              >
                <Bluetooth className="w-4 h-4 mr-2" />
                Connect via Bluetooth
              </Button>
            )}
            <Button 
              onClick={scanForDevices} 
              disabled={isScanning}
              variant="outline"
              className="dark:text-white dark:border-gray-600"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" />
                  Scan
                </>
              )}
            </Button>
          </div>

          {/* Connected Printers & Set Default */}
          {connectedPrinters.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Connected Printers</h4>
              <div className="space-y-2">
                {connectedPrinters.map((device) => (
                  <div 
                    key={device.id} 
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${device.isDefault ? 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300' : 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300'}`}>
                        <Printer className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-medium dark:text-white flex items-center gap-2">
                          {device.name}
                          {device.isDefault && <Badge variant="default" className="bg-green-600">Default</Badge>}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center gap-1 uppercase">
                          {device.connection === 'usb' ? <Usb className="w-3 h-3" /> : <Bluetooth className="w-3 h-3" />}
                          {device.connection}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!device.isDefault && (
                        <Button 
                          onClick={() => setDefaultPrinter(device.id)}
                          variant="outline"
                          className="dark:text-white dark:border-gray-600"
                        >
                          Set Default
                        </Button>
                      )}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => disconnectDevice(device.id)}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Receipt Configuration Button */}
          <div className="pt-2">
            <Button 
              onClick={() => setShowReceiptConfig(true)}
              variant="outline"
              className="w-full sm:w-auto dark:text-white dark:border-gray-600"
            >
              <Settings className="w-4 h-4 mr-2" />
              Receipt Configuration
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Receipt Configuration Dialog */}
      <Dialog open={showReceiptConfig} onOpenChange={setShowReceiptConfig}>
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto scrollbar-hide [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar-thumb]:hidden [&::-webkit-scrollbar-track]:hidden">
          <DialogHeader>
            <DialogTitle>Receipt Configuration</DialogTitle>
            <DialogDescription>
              Customize how receipts look when printing from the scanner and sales screen.
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="text-sm text-gray-500 py-4">Loading settings…</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="storeName" className="dark:text-gray-300 text-sm">Store Name</Label>
                  <Input
                    id="storeName"
                    value={receiptSettings.storeName}
                    onChange={(e) => setReceiptSettings((s) => ({ ...s, storeName: e.target.value }))}
                    placeholder="SmartPOS+ Store"
                    className="dark:bg-gray-700 dark:border-gray-600 dark:text-white h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="storePhone" className="dark:text-gray-300 text-sm">Store Phone</Label>
                  <Input
                    id="storePhone"
                    value={receiptSettings.storePhone}
                    onChange={(e) => setReceiptSettings((s) => ({ ...s, storePhone: e.target.value }))}
                    placeholder="+63 900 000 0000"
                    className="dark:bg-gray-700 dark:border-gray-600 dark:text-white h-9"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="storeAddress" className="dark:text-gray-300 text-sm">Store Address</Label>
                <Textarea
                  id="storeAddress"
                  value={receiptSettings.storeAddress}
                  onChange={(e) => setReceiptSettings((s) => ({ ...s, storeAddress: e.target.value }))}
                  placeholder="Street, City, Province, ZIP"
                  rows={1.5}
                  className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="headerNote" className="dark:text-gray-300 text-sm">Header Note</Label>
                  <Textarea
                    id="headerNote"
                    value={receiptSettings.headerNote}
                    onChange={(e) => setReceiptSettings((s) => ({ ...s, headerNote: e.target.value }))}
                    rows={1.5}
                    className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="footerNote" className="dark:text-gray-300 text-sm">Footer Note</Label>
                  <Textarea
                    id="footerNote"
                    value={receiptSettings.footerNote}
                    onChange={(e) => setReceiptSettings((s) => ({ ...s, footerNote: e.target.value }))}
                    rows={1.5}
                    className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="printerDeviceName" className="dark:text-gray-300 text-sm">Printer Name</Label>
                  <Input
                    id="printerDeviceName"
                    value={receiptSettings.printerDeviceName}
                    onChange={(e) => setReceiptSettings((s) => ({ ...s, printerDeviceName: e.target.value }))}
                    placeholder="Leave empty for system default"
                    className="dark:bg-gray-700 dark:border-gray-600 dark:text-white h-9"
                  />
                  <p className="text-xs text-gray-500">
                    Optional. Use the exact printer name from your system.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="dark:text-gray-300 text-sm">Paper Width</Label>
                  <Select
                    value={receiptSettings.paperWidth}
                    onValueChange={(value: '58mm' | '80mm') =>
                      setReceiptSettings((s) => ({ ...s, paperWidth: value }))
                    }
                  >
                    <SelectTrigger className="dark:bg-gray-700 dark:border-gray-600 dark:text-white h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="dark:bg-gray-800 dark:border-gray-700">
                      <SelectItem value="58mm" className="dark:text-white">58mm</SelectItem>
                      <SelectItem value="80mm" className="dark:text-white">80mm</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="dark:text-gray-300 text-sm">Auto Print on Sale</Label>
                  <div className="flex items-center justify-between rounded-lg border dark:border-gray-600 px-3 py-2 h-9">
                    <span className="text-xs text-gray-700 dark:text-gray-300">Auto print</span>
                    <Switch
                      checked={receiptSettings.autoPrintOnSale}
                      onCheckedChange={(checked) =>
                        setReceiptSettings((s) => ({ ...s, autoPrintOnSale: checked }))
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-lg border dark:border-gray-600 px-3 py-2 h-10">
                  <div>
                    <div className="text-xs font-medium text-gray-800 dark:text-white">Show Date & Time</div>
                  </div>
                  <Switch
                    checked={receiptSettings.showDateTime}
                    onCheckedChange={(checked) =>
                      setReceiptSettings((s) => ({ ...s, showDateTime: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border dark:border-gray-600 px-3 py-2 h-10">
                  <div>
                    <div className="text-xs font-medium text-gray-800 dark:text-white">Show Staff Name</div>
                  </div>
                  <Switch
                    checked={receiptSettings.showStaffName}
                    onCheckedChange={(checked) =>
                      setReceiptSettings((s) => ({ ...s, showStaffName: checked }))
                    }
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleTestPrint}
              disabled={saving}
              className="dark:text-white dark:border-gray-600 h-9"
            >
              Print Test Receipt
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="bg-[#FF8882] hover:bg-[#FF7770] text-white h-9"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Scanner & Other Devices Section */}
      <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2 dark:text-white">
            <Scan className="w-5 h-5 text-[#FF8882]" />
            Scanners & Other Devices
          </CardTitle>
          <CardDescription className="dark:text-gray-400">
            Connect external scanners and other hardware.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <Scan className="w-4 h-4" /> External Scanner
              </h4>
              <div className="flex gap-2">
                <Button 
                  onClick={async () => {
                    if (isUSBSupported) {
                      // For demo, select the first available scanner
                      const scanner = availableDevices.find(d => d.type === 'scanner');
                      if (scanner) {
                        await selectDevice(scanner);
                      }
                    }
                  }}
                  disabled={!isUSBSupported}
                  variant="outline"
                  className="flex-1 gap-2 dark:text-white dark:border-gray-600"
                >
                  <Usb className="w-4 h-4" /> USB
                </Button>
                <Button 
                  onClick={async () => {
                    if (isBluetoothSupported) {
                      // For demo, select the first available scanner
                      const scanner = availableDevices.find(d => d.type === 'scanner');
                      if (scanner) {
                        await selectDevice(scanner);
                      }
                    }
                  }}
                  disabled={!isBluetoothSupported}
                  variant="outline"
                  className="flex-1 gap-2 dark:text-white dark:border-gray-600"
                >
                  <Bluetooth className="w-4 h-4" /> BT
                </Button>
              </div>
            </div>
          </div>

          {/* All Connected Devices */}
          <div className="pt-4">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">All Connected Devices</h4>
            <div className="space-y-2">
              <AnimatePresence>
                {connectedDevices.map((device) => (
                  <motion.div
                    key={device.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${device.type === 'printer' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                        {device.type === 'printer' ? <Printer className="w-4 h-4" /> : <Scan className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="text-sm font-medium dark:text-white">{device.name}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-1 uppercase">
                          {device.connection === 'usb' ? <Usb className="w-3 h-3" /> : <Bluetooth className="w-3 h-3" />}
                          {device.connection}
                          {device.isDefault && ' • Default'}
                        </div>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => disconnectDevice(device.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </motion.div>
                ))}
              </AnimatePresence>

              {connectedDevices.length === 0 && (
                <div className="text-center py-8">
                  <Smartphone className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">No external devices connected.</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    </LocalizedContent>
  );
};

export default ExternalDeviceManager;
