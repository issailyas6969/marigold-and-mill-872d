import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

if (!process.env.AWS_REGION) {
  console.error('Missing required environment variable: AWS_REGION');
  process.exit(1);
}
if (!process.env.TABLE_NAME) {
  console.error('Missing required environment variable: TABLE_NAME');
  process.exit(1);
}

const TABLE_NAME = process.env.TABLE_NAME;
const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const db = DynamoDBDocumentClient.from(client);

const TIME_SLOTS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00'];

const FALLBACK_MENU = [
  { id: 'm1', name: 'Buttered sourdough & jam', description: 'Country loaf baked at 6am, cultured butter, whatever fruit is best that week.', price: 7, tag: 'Baked daily' },
  { id: 'm2', name: 'Marigold breakfast sandwich', description: 'Folded egg, aged cheddar, pickled chilli, house milk bun.', price: 11, tag: 'Most ordered' },
  { id: 'm3', name: 'Cardamom bun', description: 'Laminated overnight, rolled by hand, gone by noon.', price: 5.5, tag: '' },
  { id: 'm4', name: 'Market toast', description: 'Thick-cut rye, whipped ricotta, roast tomatoes, olive oil, herbs.', price: 12, tag: 'Vegetarian' },
  { id: 'm5', name: 'Filter coffee', description: 'Rotating single origin, brewed by the cup on the Moccamaster.', price: 4.5, tag: 'Refills $1' }
];

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', function (req, res) {
  res.status(200).send('ok');
});

app.get('/api/menu', async function (req, res) {
  try {
    const result = await db.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'MENU' }
    }));
    const items = (result.Items || []).map(function (row) {
      return {
        id: String(row.id || row.sk || ''),
        name: String(row.name || ''),
        description: String(row.description || ''),
        price: Number(row.price) || 0,
        tag: String(row.tag || '')
      };
    }).sort(function (a, b) { return a.price - b.price; });
    res.json(items.length > 0 ? items : FALLBACK_MENU);
  } catch (err) {
    console.error('Menu query failed:', err.name);
    res.status(500).json({ error: 'The menu could not be loaded. Please refresh in a moment.' });
  }
});

app.post('/reservations', async function (req, res) {
  try {
    const body = req.body || {};
    const name = cleanText(body.name, 80);
    const phone = cleanText(body.phone, 30);
    const notes = cleanText(body.notes, 280);
    const date = cleanText(body.date, 10);
    const time = cleanText(body.time, 5);
    const partySize = Number(body.partySize);

    if (name.length < 2) {
      return res.status(400).json({ error: 'Please tell us the name for the booking.' });
    }
    if (!/^[0-9+()\-\s]{7,30}$/.test(phone)) {
      return res.status(400).json({ error: 'Please add a phone number we can reach you on.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Pick a date for your visit.' });
    }
    if (TIME_SLOTS.indexOf(time) === -1) {
      return res.status(400).json({ error: 'Pick a sitting between 8am and 2pm.' });
    }
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10) {
      return res.status(400).json({ error: 'Tables seat 1 to 10. Call us for a larger group.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (date < today) {
      return res.status(400).json({ error: 'That date has already passed. Pick today or later.' });
    }

    const id = randomUUID();
    const item = {
      pk: 'RESERVATION',
      sk: 'RES#' + date + '#' + id,
      id: id,
      date: date,
      time: time,
      partySize: partySize,
      name: name,
      phone: phone,
      notes: notes,
      status: 'requested',
      createdAt: new Date().toISOString()
    };
    await db.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

    const firstName = name.split(' ')[0];
    res.status(201).json({
      ok: true,
      id: id,
      message: 'Thanks, ' + firstName + '. We have your request for ' + partySize + ' on ' + date + ' at ' + time + ' and will confirm by phone.'
    });
  } catch (err) {
    console.error('Reservation write failed:', err.name);
    res.status(500).json({ error: 'We could not save that booking. Please call us on (503) 555-0148.' });
  }
});

app.use(function (req, res) {
  res.status(404).json({ error: 'Not found' });
});

app.listen(3000, '0.0.0.0', function () {
  console.log('Marigold & Mill listening on port 3000');
});
