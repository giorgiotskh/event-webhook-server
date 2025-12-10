// made by Giorgi Otskheli
// Telegram Bot Webhook Server
// Deploy this to Heroku, Railway, Render, or any Node.js hosting

const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());

// Initialize Firebase Admin
// Supports both file-based and environment variable-based credentials
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  } else {
    serviceAccount = require('./firebase-service-account.json');
  }
} catch (error) {
  console.error('Error loading Firebase credentials:', error);
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';

app.get('/', (req, res) => {
  res.send('Telegram Bot Webhook Server is running!');
});

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    if (update.callback_query) {
      const { data, message, from } = update.callback_query;
      const [action, eventId] = data.split('_');
      
      let status = 'pending';
      let statusText = '';
      let statusEmoji = '';
      
      if (action === 'accept') {
        status = 'approved';
        statusText = 'Accepted';
        statusEmoji = '✅';
      } else if (action === 'waitlist') {
        status = 'waitlisted';
        statusText = 'Waitlisted';
        statusEmoji = '⏳';
      } else if (action === 'decline') {
        status = 'rejected';
        statusText = 'Declined';
        statusEmoji = '❌';
      }
      
      // Get event details to create notification
      let eventData = null;
      let creatorPhoneNumber = '';
      let eventName = '';
      
      try {
        const eventDoc = await db.collection('events').doc(eventId).get();
        if (eventDoc.exists) {
          eventData = eventDoc.data();
          creatorPhoneNumber = eventData.creatorPhoneNumber || '';
          eventName = eventData.name || 'Your Event';
        }
      } catch (error) {
        console.error('Error fetching event:', error);
      }
      
      // Update Firestore event status
      try {
        await db.collection('events').doc(eventId).update({ status });
        console.log(`Event ${eventId} updated to status: ${status}`);
      } catch (error) {
        console.error('Error updating Firestore:', error);
      }
      
      // Create notification for event creator
      if (creatorPhoneNumber) {
        try {
          let notificationTitle = '';
          let notificationMessage = '';
          
          if (action === 'accept') {
            notificationTitle = 'Event Approved! 🎉';
            notificationMessage = `Your event "${eventName}" has been approved and is now visible on the map and in search results.`;
          } else if (action === 'waitlist') {
            notificationTitle = 'Event Waitlisted ⏳';
            notificationMessage = `Your event "${eventName}" has been waitlisted. We'll review it again soon.`;
          } else if (action === 'decline') {
            notificationTitle = 'Event Declined ❌';
            notificationMessage = `Unfortunately, your event "${eventName}" has been declined. Please review our guidelines and try again.`;
          }
          
          await db.collection('notifications').add({
            type: `event_${status}`,
            title: notificationTitle,
            message: notificationMessage,
            creatorPhoneNumber: creatorPhoneNumber,
            eventId: eventId,
            eventName: eventName,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isRead: false,
          });
          console.log(`Notification created for phone: ${creatorPhoneNumber}`);
        } catch (error) {
          console.error('Error creating notification:', error);
        }
      }
      
      // Answer callback query
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: update.callback_query.id,
        text: `${statusEmoji} Event ${statusText}`,
        show_alert: false
      });
      
      // Edit message to show status
      const adminName = from.username ? `@${from.username}` : from.first_name;
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: message.text + `\n\n${statusEmoji} <b>${statusText}</b> by ${adminName}`,
        parse_mode: 'HTML'
      });
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

