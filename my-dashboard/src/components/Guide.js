import { useEffect, useRef } from 'react';
import accountMenu from '../assets/guide/account-menu.webp';
import addToList from '../assets/guide/add-to-list.webp';
import categories from '../assets/guide/categories.webp';
import headerSignIn from '../assets/guide/header-sign-in.webp';
import headerYourList from '../assets/guide/header-your-list.webp';
import howMany from '../assets/guide/how-many.webp';
import review from '../assets/guide/review.webp';
import search from '../assets/guide/search.webp';
import setup from '../assets/guide/setup.webp';
import signInForm from '../assets/guide/sign-in-form.webp';
import yourList from '../assets/guide/your-list.webp';

// "How to request supplies": a step-by-step guide for clinic staff. The pictures are real
// screenshots of this site, with a red box around what to click.

const SECTIONS = [
  ['before', 'Before you start'],
  ['account', '1. Set up your account'],
  ['signin', '2. Sign in'],
  ['find', '3. Find a supply'],
  ['amount', '4. Choose how many'],
  ['check', '5. Check your list'],
  ['send', '6. Send it'],
  ['follow', '7. Follow your request'],
  ['labels', 'What the labels mean'],
  ['help', 'Questions and problems'],
];

// A screenshot. `alt` says what the picture shows, for people who can't see it.
function Shot({ src, alt, caption, width, height, narrow }) {
  return (
    <figure className={`guide__shot${narrow ? ' guide__shot--narrow' : ''}`}>
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function Step({ id, n, title, children }) {
  return (
    <section className="guide__step" id={`guide-${id}`} aria-labelledby={`guide-${id}-title`}>
      <h2 id={`guide-${id}-title`} className="guide__step-title">
        {n && <span className="guide__n">{n}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function Guide({ contactEmail, signedIn }) {
  const titleRef = useRef(null);
  useEffect(() => titleRef.current && titleRef.current.focus(), []);
  const jump = (id) => (e) => {
    e.preventDefault();
    const el = document.getElementById(`guide-${id}`);
    if (el) {
      el.scrollIntoView({ block: 'start' });
      el.querySelector('h2').setAttribute('tabindex', '-1');
      el.querySelector('h2').focus({ preventScroll: true });
    }
  };

  return (
    <div className="guide">
      <header className="guide__intro">
        <p className="guide__kicker">For partner clinics</p>
        <h1 className="guide__title" tabIndex={-1} ref={titleRef}>How to request supplies</h1>
        <p className="guide__lede">
          Blueprints for Pangaea collects unused medical supplies and sends them to clinics that need them.
          This page shows you how to ask for supplies, one step at a time, with a picture of each step.
          It takes about 10 minutes the first time and 2 or 3 minutes after that.
        </p>
        <div className="guide__short" aria-labelledby="guide-short-title">
          <p className="guide__short-title" id="guide-short-title">In short</p>
          <ol>
            <li><strong>Sign in</strong> with the email Blueprints invited.</li>
            <li>Click <strong>Add to list</strong> next to each supply you need.</li>
            <li>Click <strong>Your list</strong> at the top, then <strong>Review and send</strong>.</li>
            <li>Click <strong>Send request</strong>. We email you as it moves along.</li>
          </ol>
          <p>The rest of this page explains each step. In every picture, a <span className="guide__red">red box</span> shows where to click.</p>
        </div>
        <div className="guide__actions">
          <a className="btn btn--primary btn--lg" href="#/">Start a request</a>
          {!signedIn && <a className="btn btn--quiet btn--lg" href="#/signin">Sign in</a>}
        </div>
      </header>

      <div className="guide__layout">
        <nav className="guide__toc" aria-label="On this page">
          <p className="guide__toc-title">On this page</p>
          <ol>
            {SECTIONS.map(([id, label]) => (
              <li key={id}><a href={`#/how-it-works`} onClick={jump(id)}>{label}</a></li>
            ))}
          </ol>
        </nav>

        <div className="guide__body">
          <Step id="before" title="Before you start">
            <p>You will need:</p>
            <ul className="guide__list">
              <li><strong>The invite email from Blueprints.</strong> Each partner clinic gets one, with a link to set up your account.</li>
              <li><strong>The work email address the invite was sent to.</strong> This is the address you sign in with.</li>
              <li><strong>A list of what your clinic needs</strong>, and roughly how many of each. A paper list is fine.</li>
            </ul>
            <p>
              No invite? Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> with your clinic’s name and
              your work email, and we’ll send one.
            </p>
            <p className="guide__note">
              <strong>Good to know:</strong> everything is free for partner clinics. A request is a list you send
              to the Blueprints team. Nothing is ordered or shipped until a person on our team reviews it.
            </p>
          </Step>

          <Step id="account" n="1" title="Set up your account (first time only)">
            <ol className="guide__steps">
              <li>Open the invite email from Blueprints and click the link in it.</li>
              <li>A page opens showing your clinic’s name and your email. <strong>Check that both are right.</strong> If not, stop and email us.</li>
              <li>Choose a password and type it in the <strong>New password</strong> box. The list under the box turns green as your password meets each rule.</li>
              <li>Type the same password again in <strong>Confirm password</strong>.</li>
              <li>Click the blue <strong>Finish setup</strong> button. You’re now signed in.</li>
            </ol>
            <Shot
              src={setup} width={464} height={751} narrow
              alt="The setup page: the clinic name and email are filled in, both password boxes are filled, all three rules are ticked green, and the Finish setup button at the bottom has a red box around it."
              caption="The setup page. Your clinic’s name and email are already filled in. Click Finish setup."
            />
            <p className="guide__tip">
              <strong>Picking a password:</strong> a short sentence is easy to remember and hard to guess,
              like <em>river bend clinic supplies</em>. Write it somewhere safe at your clinic.
            </p>
            <p>The invite link works for 7 days. If it has expired, the page will tell you, and you can ask us for a new one.</p>
          </Step>

          <Step id="signin" n="2" title="Sign in">
            <p>
              You can look at the supplies without signing in. You need to sign in to send a request
              and to see your past requests.
            </p>
            <ol className="guide__steps">
              <li>Click <strong>Sign in</strong> at the far right of the top of the page.</li>
            </ol>
            <Shot
              src={headerSignIn} width={737} height={64}
              alt="The top of the page: How it works, Email for help, Your list is empty, and then, on its own at the far right, Sign in with a red box around it."
              caption="Sign in is at the far right of the top of every page."
            />
            <ol className="guide__steps" start={2}>
              <li>Type your work email and your password.</li>
              <li>Click the blue <strong>Sign in</strong> button.</li>
            </ol>
            <Shot
              src={signInForm} width={464} height={486} narrow
              alt="The sign-in page with the Email and Password boxes filled in, and a red box around the blue Sign in button."
              caption="Type your email and password, then click Sign in."
            />
            <p className="guide__tip">
              <strong>Using a shared computer?</strong> Sign out when you finish, so the next person can’t send
              requests in your clinic’s name. Step 7 shows where Sign out is.
            </p>
          </Step>

          <Step id="find" n="3" title="Find a supply">
            <p>There are two ways to find what you need.</p>
            <p><strong>Way 1: search.</strong> Type a word in the <strong>What do you need?</strong> box at the top of the page, like <em>gloves</em>, <em>syringe</em> or <em>gauze</em>. The supplies show up as you type. Short, simple words work best.</p>
            <Shot
              src={search} width={788} height={174}
              alt="The search box, labelled What do you need?, with the word gloves typed in it and a blue Search button. A red box is around it."
              caption="The search box is at the top of the supply pages."
            />
            <p><strong>Way 2: choose a category.</strong> Click a category, like <em>Gloves</em> or <em>Wound Care</em>. The list of all categories is on the left. On a phone, tap <strong>Categories</strong> at the top of the screen.</p>
            <Shot
              src={categories} width={920} height={600}
              alt="The home page: the list of categories on the left, the search box at the top, and the category boxes below. A red box is around the Airway & Oxygen category."
              caption="Click any category box, or a name in the list on the left."
            />
            <p>
              Each supply shows its name, the maker, how many are in stock and its use-by date. Click a supply’s
              name to see more about it.
            </p>
          </Step>

          <Step id="amount" n="4" title="Choose how many">
            <ol className="guide__steps">
              <li>Next to the supply, click <strong>Add to list</strong>. One is added to your list.</li>
            </ol>
            <Shot
              src={addToList} width={987} height={89}
              alt="One supply row: Elastic bandage, the maker, the batch, Use by Jul 2028, 98 in stock, and an Add to list button with a red box around it."
              caption="Click Add to list next to the supply you need."
            />
            <ol className="guide__steps" start={2}>
              <li>The button turns green and says <strong>Added</strong> for a moment, then becomes <strong>−</strong> and <strong>+</strong> buttons. The <strong>Your list</strong> button at the top also flashes, to show the supply went in.</li>
              <li>Click <strong>+</strong> to add more, or <strong>−</strong> for fewer. You can also click the number and type the amount you need.</li>
              <li>Keep going: add every supply your clinic needs before sending.</li>
            </ol>
            <Shot
              src={howMany} width={987} height={95}
              alt="The same row after clicking Add to list: a minus button, the number 1 and a plus button, with a red box around them."
              caption="Use − and + to choose how many."
            />
            <ul className="guide__list">
              <li>You can’t ask for more than we have in stock. The number stops at the most available.</li>
              <li>To take a supply off, lower it to 0 or click <strong>Remove</strong> in your list. If you remove something by mistake, click <strong>Undo</strong> on the message at the bottom of the screen.</li>
              <li>Your list is saved on this computer, so you can close the page and come back later.</li>
            </ul>
          </Step>

          <Step id="check" n="5" title="Check your list">
            <ol className="guide__steps">
              <li>Click <strong>Your list</strong> at the top of the page. The number shows how many different supplies you’ve added.</li>
            </ol>
            <Shot
              src={headerYourList} width={927} height={64}
              alt="The top of the page: How it works, My requests, Email for help, the dark blue Your list (3) button with a red box around it, and the clinic’s name at the far right."
              caption="Your list (3) means you’ve added 3 different supplies."
            />
            <ol className="guide__steps" start={2}>
              <li>Your list opens on the right side. Read through it and change any amounts.</li>
              <li>When it looks right, click the blue <strong>Review and send</strong> button at the bottom.</li>
            </ol>
            <Shot
              src={yourList} width={480} height={900} narrow
              alt="Your list, open on the right: three supplies, each with minus and plus buttons and Remove. At the bottom, a red box is around the blue Review and send button."
              caption="Your list. Click Review and send when it looks right."
            />
          </Step>

          <Step id="send" n="6" title="Send it">
            <ol className="guide__steps">
              <li>On the <strong>Review your request</strong> page, check the list of supplies one last time.</li>
              <li>Check that <strong>Sending as</strong> shows your clinic and your email. We send updates to that email.</li>
              <li>Click the big blue <strong>Send request</strong> button.</li>
            </ol>
            <Shot
              src={review} width={792} height={713}
              alt="The Review your request page: the supplies requested, the Sending as box with the clinic and email, and a red box around the blue Send request button."
              caption="Check the supplies and Sending as, then click Send request."
            />
            <p>
              You’ll see a page with your <strong>request number</strong> (it starts with <span className="num">REQ-</span>),
              and we’ll email you a copy. Keep the number in case you need to ask us about the request.
            </p>
            <p className="guide__note">
              <strong>Clicked Send and nothing happened?</strong> Wait a minute before trying again. The first
              request after a quiet spell can be slow. The page tells you if something went wrong, and your list
              is never lost.
            </p>
          </Step>

          <Step id="follow" n="7" title="Follow your request">
            <ol className="guide__steps">
              <li>Click your clinic’s name at the far right of the top of the page.</li>
              <li>Click <strong>My requests</strong>. Each request shows where it is. (<strong>Sign out</strong> is here too.)</li>
            </ol>
            <Shot
              src={accountMenu} width={333} height={271} narrow
              alt="The menu that opens under the clinic name: Signed in as Ana Morales, then My requests with a red box around it, then Sign out."
              caption="Your clinic’s name opens this menu."
            />
            <p>We also email you each time your request moves to the next step:</p>
            <dl className="guide__status">
              <div><dt>Submitted</dt><dd>We have your request. Nothing for you to do.</dd></div>
              <div><dt>Under review</dt><dd>Someone on our team is checking it against what we have.</dd></div>
              <div><dt>Approved</dt><dd>Your request is approved and is being prepared to ship.</dd></div>
              <div><dt>Shipped</dt><dd>Your supplies are on the way.</dd></div>
              <div><dt>Denied</dt><dd>We can’t fill this request right now. Email us if you have questions. You can send a new request any time.</dd></div>
            </dl>
            <p>
              Need to change a request you’ve already sent? Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>{' '}
              with your request number.
            </p>
          </Step>

          <Step id="labels" title="What the labels mean">
            <dl className="guide__labels">
              <div><dt><span className="badge badge--low">Low stock</span></dt><dd>Only a few left. Ask soon if you need it.</dd></div>
              <div><dt><span className="badge badge--soon">Expires soon</span></dt><dd>The use-by date is close. Only ask if you can use it in time.</dd></div>
              <div><dt><span className="badge badge--info">Team check</span></dt><dd>Our team checks this item by hand before it ships, so approval may take a little longer.</dd></div>
              <div><dt><span className="badge badge--hold">On hold</span></dt><dd>Set aside for another clinic. You can’t request it right now.</dd></div>
            </dl>
          </Step>

          <Step id="help" title="Questions and problems">
            <dl className="guide__faq">
              <div>
                <dt>I forgot my password.</dt>
                <dd>On the sign-in page, click <strong>Forgot password?</strong>, type your work email and click <strong>Send reset link</strong>. Check your email (and your spam folder) for a link. It works for 1 hour.</dd>
              </div>
              <div>
                <dt>It says “Too many tries”.</dt>
                <dd>After 5 wrong passwords, sign-in pauses for 15 minutes to protect your account. Wait, or reset your password now.</dd>
              </div>
              <div>
                <dt>It says “That email and password don’t match”.</dt>
                <dd>Check for typing mistakes and that Caps Lock is off. Click <strong>Show</strong> to see what you typed. Make sure you’re using the email your invite was sent to.</dd>
              </div>
              <div>
                <dt>I can’t find the supply I need.</dt>
                <dd>Try a shorter or different word (<em>bandage</em> instead of <em>elastic bandage roll</em>). If it’s not listed, we don’t have it right now. Email us; we often get new donations.</dd>
              </div>
              <div>
                <dt>Someone else at my clinic needs to send requests.</dt>
                <dd>Email us their name and work email and we’ll send them their own invite. Please don’t share passwords.</dd>
              </div>
              <div>
                <dt>Something else is wrong.</dt>
                <dd>Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. Tell us your clinic’s name, what you were trying to do and what the page said. A screenshot helps.</dd>
              </div>
            </dl>
          </Step>

          <div className="guide__end">
            <p className="guide__end-title">Ready?</p>
            <a className="btn btn--primary btn--lg" href="#/">Start a request</a>
          </div>
        </div>
      </div>
    </div>
  );
}
