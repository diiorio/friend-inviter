declare const chrome: typeof browser; // Chrome vs Firefox compat

/**
 * Watches for changes to the page and adds the Select Friends button to
 * the Invite menu
 */
const modalCreationObserver = new MutationObserver((recs) => {
  // Check if a change to the page is the invite modal opening
  const inviteModal = findInviteModal(recs);
  if (!inviteModal) return;
  console.log("Detected invite modal. Adding Select Friends button.");

  // Copy the "Invite" button to create the "Select Friends" button
  const submit = inviteModal.querySelector<HTMLButtonElement>("footer button");
  if (!submit) {
    thralert('Could not find "Invite" button to enhance.');
  }
  const container = submit.parentElement as HTMLElement;
  const clonetainer = container.cloneNode(true) as HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const btn = clonetainer.querySelector<HTMLButtonElement>("button")!;
  btn.disabled = false;
  btn.className = "px-4"; // Tailwind util
  btn.textContent = "Select Friends";
  btn.onclick = selectFriends;
  container.insertAdjacentElement("beforebegin", clonetainer);
});
modalCreationObserver.observe(document.body, { childList: true });

// --- --- --- //

/**
 * Selects friends when the button is clicked.
 */
async function selectFriends() {
  console.log("Select Friends button clicked");
  const user = getUser();

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const modalBody = document.querySelector<HTMLDivElement>(
    "div[id^=modal-][id$=-body]" // full ID is modal-<random>-body
  )!;

  const listContainer = modalBody.querySelector('div[class=""]');
  if (!listContainer) {
    thralert("Could not find list of friends?");
  }

  const strLimit = modalBody.querySelector("h4")?.textContent.match(/\d+/)?.[0];
  let limit = Infinity;
  let shouldScroll = false;
  if (typeof strLimit === "string") {
    limit = Number(strLimit);
    if (limit === 0) {
      thralert("No remaining invites to add.");
    } else if (Number.isNaN(limit)) {
      thralert("Could not parse invite limit.");
    }
    shouldScroll = true;
  }

  const token = await getAuthenticityToken(user);
  let page = 1;
  let friends = await getFriendList(user, token, page);
  let noMutationsTimeout: ReturnType<typeof setTimeout>;

  /* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *\
  NOTE: For "invitee" here, I mean every user in the potential invitee list,
  not just those who have already been selected/invited.

  The goal here is to scroll through the invitee list and any friends that
  have not yet been invited. The challenge of doing this efficiently is that
  the friends list and invitee list are both paginated. The friends list is an
  API call, so that's easy to work with. The invitee list is added to the page
  in chunks as the user scrolls. I haven't found a clean way to easily detect
  when that list is fully loaded. So we have to work both with `fetch` and with
  `MutationObserver`, which makes things a bit mucky. Additionally, the user
  may have already selected some invitees, who may or may not be friends. The
  overall flow of logic is as follows:
  
  0. Assume that when the user clicks the button, the initial invitee list is
     loaded on the page. It may or may not be the full list, and it may or may
     not have users already selected, who may or may not be friends.
  1. Load the first page of the "friends to check" list.
  2. For each invitee loaded on the page:
     - If they are a friend, remove them from the "friends to check" list.
     - If they have not been selected, select them.
  3. If the "friends to check" list is ever empty, load the next page and
     re-check all invitees, starting from the top of the list.
  4. After the last invitee is checked, scroll to the end of the list to load
     more invitees.
  5. When the new invitees are loaded, check the newly added nodes as above.
     If new friends are loaded, check all of the invitees on the page, not
     just this batch of newly added ones.
  6. Stop checking when all of the invites are used up, when there are no more
     friends to check, or when new invitees stop getting added to the page.
  \* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

  /** @returns {Promise<'continue'|'done'|'new-friends'>} */
  const checkState = async (): Promise<"continue" | "done" | "new-friends"> => {
    if (limit === 0) {
      return "done"; // Can't invite more people
    } else if (friends.list.size === 0) {
      if (friends.done) {
        clearTimeout(noMutationsTimeout);
        inviteListObserver.disconnect();
        console.log("Invited all friends.");
        return "done"; // No more friends to check for
      } else {
        page += 1;
        console.log(`Loading more friends to check (page ${String(page)}).`);
        friends = await getFriendList(user, token, page);
        return "new-friends";
      }
    }
    return "continue";
  };

  const loadInviteesIfNeeded = (lastInvitee: HTMLElement) => {
    if (!friends.done) {
      console.log("Scrolling to load more invitees.");
      lastInvitee.scrollIntoView();
      // If no mutations after 3 seconds, stop watching
      noMutationsTimeout = setTimeout(() => {
        inviteListObserver.disconnect();
        console.log("Did not load any invitees in 3 seconds. Stopping.");
      }, 3000);
    }
  };

  const checkStatic = async () => {
    for (let i = 0; i < listContainer.childElementCount; i += 1) {
      const label = listContainer.children[i] as HTMLLabelElement;

      const invitee = label.querySelector("a")?.title;
      if (!invitee) {
        thralert("Could not parse invitee list.");
      }

      // Don't need to parse non-friend invitees
      if (!friends.list.has(invitee)) {
        continue;
      }
      // Invitee is a friend -- remove them from the list to be checked
      friends.list.delete(invitee);

      if (isInvited(label)) continue;

      // Friend is not yet invited -- invite them
      label.click();
      limit -= 1;

      const state = await checkState();
      if (state === "done") {
        return; // No more friends to check
      } else if (state === "new-friends") {
        i = -1; // Check for new friends from start of invitee list
      }
    }

    if (shouldScroll) {
      console.log("Loading more invitee list.");
      loadInviteesIfNeeded(listContainer.lastElementChild as HTMLElement);
    } else {
      console.log("Not in scrolling mode. Done!");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const inviteListObserver = new MutationObserver(async (recs) => {
    clearTimeout(noMutationsTimeout);
    console.log("Detected more invitees added to list.");
    for (const { addedNodes } of recs) {
      for (const label of addedNodes) {
        if (!(label instanceof HTMLLabelElement)) continue;
        const invitee = label.querySelector("a")?.title;
        if (!invitee) {
          thralert("Could not parse invitee list.");
        }

        // Don't need to parse non-friend invitees
        if (!friends.list.has(invitee)) {
          continue;
        }
        friends.list.delete(invitee);

        label.click();
        limit -= 1;

        const state = await checkState();
        if (state === "done") {
          return; // No more friends to check
        } else if (state === "new-friends") {
          // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
          return await checkStatic(); // Check for new friends from start of invitee list
        }
      }
      const lastRecord = recs.findLast((rec) => rec.addedNodes.length > 0);
      const lastElement = lastRecord?.addedNodes.item(
        lastRecord.addedNodes.length - 1
      ) as HTMLElement;
      loadInviteesIfNeeded(lastElement);
    }
  });
  inviteListObserver.observe(listContainer, { childList: true });

  // Trigger first pass
  await checkStatic();
}

// --- --- --- //

/** Watches changes on the page to see when the Invite menu pops up. */
function findInviteModal(recs: MutationRecord[]) {
  for (const rec of recs) {
    for (const node of rec.addedNodes as Iterable<HTMLElement>) {
      if ("dataset" in node && node.dataset.test === "invite-to-event-modal") {
        return node;
      }
    }
  }
}

/**
 * Loads your authenticity token, which is required to view your friend list.
 * It doesn't seem to be exposed on the page anywhere, so the background script
 * watches page requests to try to find it. Here, we ask the background script
 * for the token. If not found, we invisibly load a page that we know uses the
 * token (the friends page) and then ask again.
 * @param {string} user
 * @returns {Promise<string>}
 */
async function getAuthenticityToken(user: string): Promise<string> {
  let token = (await chrome.runtime.sendMessage({
    action: "authenticity_token",
    mode: "sync",
  })) as string | undefined;
  if (token) {
    return token;
  }
  console.log("Loading authenticity token in iframe.");
  const iframe = document.createElement("iframe");
  iframe.style.position = "absolute";
  iframe.style.visibility = "hidden";
  iframe.sandbox.add("allow-same-origin", "allow-scripts");
  iframe.src = `/${user}/friends`;

  try {
    document.body.appendChild(iframe);
    token = (await chrome.runtime.sendMessage({
      action: "authenticity_token",
      mode: "subscribe",
      timeout: 3000,
    })) as string | undefined;
    if (token) {
      return token;
    }
    throw new Error("Could not get authenticity token.");
  } catch (err) {
    const redirect = confirm(
      "Could not load your friend list. Please view your friends and try again."
    );
    if (redirect) {
      location.href = `/${user}/friends`;
      return ""; // ignored
    }
    throw err;
  } finally {
    iframe.remove();
  }
}

/** Extracts your username from the nav bar, with a fall back to manual entry. */
function getUser() {
  let user: string | null | undefined = (
    document.body.querySelector("#sidebar-general a img")?.parentElement as
      | HTMLAnchorElement
      | undefined
  )?.pathname.slice(1);
  if (!user) {
    user = prompt("Couldn't detect your username? Enter it manually...");
    user = user?.trim();
    if (!user) {
      thralert("Okay, never mind...", "Could not detect username.");
    }
  }
  return user;
}

/**
 * Gets a single page of a user's friend list
 * @param {string} user Username to get the friends of
 * @param {string} token Authenticity token
 * @param {number} page Which page of the friends list to get
 */
async function getFriendList(user: string, token: string, page: number) {
  const res = await fetch(`https://fetlife.com/${user}/relations`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      authenticity_token: token,
      page: page,
      tab: "friends",
      search_query: "",
      sort_order: "az",
      per_page: 30,
    }),
  });

  interface FriendsData {
    error?: string;
    users?: { nickname: string }[];
    no_more: boolean;
  }
  const json = (await res.json().catch(() => undefined)) as
    | FriendsData
    | undefined;

  if (!res.ok || !json || json.error) {
    const reason = res.ok
      ? `HTTP ${String(res.status)} ${res.statusText}`
      : "invalid response";
    const message = `Failed to get page ${String(
      page
    )} of ${user}'s friends (${reason})`;
    thralert(message, json?.error ? `${message}: ${json.error}` : message);
  }

  const friends = new Set(json.users?.map((u) => u.nickname));
  if (friends.size === 0) {
    thralert("You have no friends? 😭");
  }

  return { list: friends, done: json.no_more };
}

// --- --- --- //
// small utils //
// --- --- --- //

/** @param {HTMLLabelElement} label  */
function isInvited(label: HTMLLabelElement) {
  return label.querySelector<HTMLInputElement>("input")?.checked;
}

/**
 * @param {string} display
 * @param {string} [detail]
 * @returns {never}
 */
function thralert(
  display: string,
  detail: string = display,
  Ctor = Error
): never {
  alert(display);
  throw new Ctor(detail);
}
