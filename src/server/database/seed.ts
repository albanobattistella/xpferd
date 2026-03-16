import { Database } from './Database.js';

/**
 * Seeds the database with sample data when empty (no parties exist).
 * Only runs in development — checks party count to prevent re-seeding.
 */
export function seedIfEmpty(): void {
  const db = Database.getInstance().getDb();
  const count = db.prepare('SELECT COUNT(*) as cnt FROM parties').get() as { cnt: number };
  if (count.cnt > 0) return;

  console.log('Seeding database with sample data...');

  // Sample seller
  db.prepare(`
    INSERT INTO parties (type, name, street, city, postal_code, country_code,
      vat_id, tax_number, contact_name, contact_phone, contact_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'seller',
    'Mustermann Consulting GmbH',
    'Berliner Straße 42',
    'Berlin',
    '10115',
    'DE',
    'DE123456789',
    '30/123/45678',
    'Max Mustermann',
    '+49 30 12345678',
    'rechnung@mustermann-consulting.de',
  );

  // Sample buyer
  db.prepare(`
    INSERT INTO parties (type, name, street, city, postal_code, country_code,
      vat_id, email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'buyer',
    'Beispiel AG',
    'Hauptstraße 1',
    'München',
    '80331',
    'DE',
    'DE987654321',
    'einkauf@beispiel-ag.de',
  );

  // Sample payment template
  db.prepare(`
    INSERT INTO payment_templates (name, payment_means_code, iban, bic, payment_terms)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'SEPA-Überweisung',
    '58',
    'DE89370400440532013000',
    'COBADEFFXXX',
    'Zahlbar innerhalb von 30 Tagen nach Rechnungseingang.',
  );

  // Sample invoice number template
  db.prepare(`
    INSERT INTO invoice_number_templates (name, prefix, digits, next_number)
    VALUES (?, ?, ?, ?)
  `).run(
    'Standard 2026',
    'RE-2026-',
    4,
    1,
  );

  // Sample line item template
  db.prepare(`
    INSERT INTO line_item_templates (name, unit_code, net_price, vat_category_code, vat_rate)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'Beratungsstunde',
    'HUR',
    120.00,
    'S',
    19.0,
  );

  // Sample invoice
  const invoiceResult = db.prepare(`
    INSERT INTO invoices (
      invoice_number, invoice_date, invoice_type_code, currency_code,
      due_date, buyer_reference,
      seller_name, seller_street, seller_city, seller_postal_code, seller_country_code,
      seller_vat_id, seller_tax_number, seller_contact_name, seller_contact_phone, seller_contact_email,
      buyer_name, buyer_street, buyer_city, buyer_postal_code, buyer_country_code,
      buyer_vat_id, buyer_email,
      payment_means_code, payment_terms, iban, bic,
      tax_category_code, tax_rate, kleinunternehmer,
      total_net_amount, total_tax_amount, total_gross_amount, amount_due
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    )
  `).run(
    'RE-2026-0001', '2026-02-15', '380', 'EUR',
    '2026-03-17', 'LW-2026-00042',
    'Mustermann Consulting GmbH', 'Berliner Straße 42', 'Berlin', '10115', 'DE',
    'DE123456789', '30/123/45678', 'Max Mustermann', '+49 30 12345678', 'rechnung@mustermann-consulting.de',
    'Beispiel AG', 'Hauptstraße 1', 'München', '80331', 'DE',
    'DE987654321', 'einkauf@beispiel-ag.de',
    '58', 'Zahlbar innerhalb von 30 Tagen nach Rechnungseingang.', 'DE89370400440532013000', 'COBADEFFXXX',
    'S', 19.0, 0,
    1250.00, 237.50, 1487.50, 1487.50,
  );

  const invoiceId = invoiceResult.lastInsertRowid;

  const insertLine = db.prepare(`
    INSERT INTO invoice_lines (invoice_id, line_number, quantity, unit_code, item_name, net_price, vat_category_code, vat_rate, line_net_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertLine.run(invoiceId, 1, 1, 'HUR', 'Webdesign Startseite', 850.00, 'S', 19.0, 850.00);
  insertLine.run(invoiceId, 2, 5, 'HUR', 'SEO-Optimierung', 80.00, 'S', 19.0, 400.00);

  console.log('Sample data seeded successfully.');
}
