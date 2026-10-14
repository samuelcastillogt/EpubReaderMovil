// Recordatorio diario local para el repaso (sin servidor de push).
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { track } from '../../services/analytics';
import { captureException } from '../../services/crash';
import { loadReviewData, saveReviewData } from './reviewStore';

const CHANNEL_ID = 'repaso-diario';
export const DEFAULT_REMINDER = { hour: 20, minute: 0 };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function enableDailyReminder(hour = DEFAULT_REMINDER.hour, minute = DEFAULT_REMINDER.minute) {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Repaso diario',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    track('reminder_permission', { granted });
    if (!granted) return false;

    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Tu repaso de hoy',
        body: '5 minutos para recordar lo que subrayaste.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
        channelId: CHANNEL_ID,
      },
    });
    const data = await loadReviewData();
    await saveReviewData({ ...data, notificationsScheduled: true });
    return true;
  } catch (error) {
    captureException(error, { where: 'enableDailyReminder' });
    return false;
  }
}

export async function disableDailyReminder() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const data = await loadReviewData();
    await saveReviewData({ ...data, notificationsScheduled: false });
  } catch (error) {
    captureException(error, { where: 'disableDailyReminder' });
  }
}
