// Everything you might want to change in one place. The Resend key is a secret, not stored here.
export const CONFIG = {
  siteUrl: 'https://signup.ashleyfisher.com',   // where guests open sign-ups
  domain: 'signup.ashleyfisher.com',            // used in calendar invite IDs
  fromName: 'Ashley Fisher',
  fromEmail: 'signups@ashleyfisher.com',        // must be on the domain verified in Resend
  replyTo: 'ashley@ashleyfisher.com',           // guest replies come to you
  adminEmails: ['ashley@ashleyfisher.com'],      // who can create and manage sign-ups (also in firestore.rules)
};
