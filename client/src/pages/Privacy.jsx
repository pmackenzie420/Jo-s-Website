import '../styles/pages/Privacy.css';

export default function Privacy() {
  return (
    <div className="privacy-container">
      <h1 className="privacy-title">Privacy Policy</h1>
      <p className="privacy-text">
        We respect your privacy and are committed to protecting your personal information.
      </p>

      <h2 className="privacy-subtitle">Information We Collect</h2>
      <p className="privacy-text">
        When you place an order or contact us, we may collect the following information:
      </p>
      <ul className="privacy-list">
        <li>Name</li>
        <li>Email address</li>
        <li>Phone number</li>
        <li>Address</li>
        <li>Order details (such as quantity and pickup date)</li>
      </ul>
      <p className="privacy-text">
        We only collect information that is necessary to process and fulfill your order and to
        communicate with you about it.
      </p>

      <h2 className="privacy-subtitle">How We Use Your Information</h2>
      <p className="privacy-text">Your information is used to:</p>
      <ul className="privacy-list">
        <li>Process and manage orders</li>
        <li>Communicate order confirmations, pickup details, or changes</li>
        <li>Provide customer support</li>
      </ul>
      <p className="privacy-text">
        We do not sell, rent, or trade your personal information.
      </p>

      <h2 className="privacy-subtitle">Emails</h2>
      <p className="privacy-text">
        We send transactional emails such as order confirmations and pickup notifications as part
        of fulfilling your order. Marketing or promotional emails are only sent if you explicitly
        opt in. You may unsubscribe from marketing emails at any time, and unsubscribing does not
        affect transactional emails related to your orders.
      </p>

      <h2 className="privacy-subtitle">Data Storage and Security</h2>
      <p className="privacy-text">
        Your information is stored securely using reputable third-party services and is accessible
        only to the business owner and authorized personnel. Reasonable safeguards are used to
        protect personal information from unauthorized access or disclosure.
      </p>

      <h2 className="privacy-subtitle">Data Retention</h2>
      <p className="privacy-text">
        We retain personal information only as long as necessary for order fulfillment, record
        keeping, and legal or accounting purposes. Information may be deleted or anonymized upon
        request, subject to legal requirements.
      </p>

      <h2 className="privacy-subtitle">Your Rights</h2>
      <p className="privacy-text">
        You may request access to, correction of, or deletion of your personal information at any
        time by contacting us.
      </p>

      <h2 className="privacy-subtitle">Contact</h2>
      <p className="privacy-text">
        If you have questions about this privacy policy or how your personal information is
        handled, please contact:
      </p>
      <p className="privacy-text">Les Fermes Soulard S.E.N.C.</p>
      <p className="privacy-text">lesfermessoulard@gmail.com</p>
      <p className="privacy-text">315 ch. Back Bush, Hemmingford, Qc</p>
    </div>
  );
}
