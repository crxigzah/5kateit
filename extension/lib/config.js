// Site settings, deal sources and limits. Regexes are case-insensitive strings.
(function (root) {
  const CONFIG = {
    defaults: {
      open_text: "^(\\+\\s*)?(add|enter|have|use|apply)\\b.{0,20}(promo|voucher|discount|offer|coupon)|^promo(tion)?s?( code)?$|^vouchers?$|^add (a )?code$",
      input_hint: "promo|voucher|discount|coupon|offer.?code|enter.?code|gift.?code",
      apply_text: "^(apply|add|redeem|submit|use( code)?|save|ok|confirm)$",
      remove_text: "^(remove|clear|delete)( (code|voucher|promo|promotion))?$|^×$|^x$",
      success_text: "(applied|added|redeemed|has been added|you('| a)re saving|discount (has been )?applied|voucher added|promo(tion)? added|success)",
      failure_text: "(not valid|invalid|isn'?t valid|expired|not recognised|not recognized|doesn'?t exist|does not exist|couldn'?t (be )?appl|can'?t be (used|applied)|cannot be (used|applied)|not eligible|isn'?t available|not available|only for new|first order only|already (been )?used|minimum (order|spend)|try (a different|another)|something went wrong|not found|unable to)",
      total_text: "(?:^|\\n)\\s*(?:order )?total(?: to pay)?[^\\n£]{0,30}\\n?\\s*£\\s?(\\d{1,4}(?:\\.\\d{2})?)",
    },
    sites: {
      deliveroo: {name: "Deliveroo", member_name: "Deliveroo Plus", member_query: "Deliveroo Plus",
                  start_url: "https://deliveroo.co.uk/", domain: "deliveroo.co.uk", query: "Deliveroo",
                  slugs: {hukd: "deliveroo", couponfollow: "deliveroo.co.uk", groupon: "deliveroo", discoup: "deliveroo",
                          wethrift: "deliveroo-uk", vouchercodes: "deliveroo.co.uk", myvouchercodes: "deliveroo",
                          dealhack: "deliveroo", subreddit: "deliveroo"}},
      justeat:   {name: "Just Eat", member_name: "Just Eat+", member_query: "Just Eat Plus",
                  start_url: "https://www.just-eat.co.uk/", domain: "just-eat.co.uk", query: "Just Eat",
                  slugs: {hukd: "just-eat", couponfollow: "just-eat.co.uk", groupon: "just-eat", discoup: "just-eat",
                          wethrift: "just-eat", vouchercodes: "just-eat.co.uk", myvouchercodes: "just-eat",
                          dealhack: "just-eat", subreddit: "JustEat"}},
      ubereats:  {name: "Uber Eats", member_name: "Uber One", member_query: "Uber One",
                  start_url: "https://www.ubereats.com/gb", domain: "ubereats.com", query: "Uber Eats",
                  slugs: {hukd: "uber-eats", couponfollow: "ubereats.com", groupon: "ubereats", discoup: "uber-eats",
                          wethrift: "uber-eats", savoo: "uber-eats-promo-codes", vouchercodes: "ubereats.com",
                          myvouchercodes: "uber-eats", dealhack: "uber-eats", subreddit: "UberEATS"}},
    },
    // {q} = search words, {slug:name} = that site's page name for the app (skipped if the app has none).
    // "search" sources run again with the membership name when the user is a member.
    sources: [
      {name: "HotUKDeals", kind: "page", search: true, url: "https://www.hotukdeals.com/search?q={q}%20code"},
      {name: "HotUKDeals vouchers", kind: "page", search: true, url: "https://www.hotukdeals.com/search/vouchers?q={q}"},
      {name: "HotUKDeals", kind: "page", url: "https://www.hotukdeals.com/{slug:hukd}"},
      {name: "Latest Deals", kind: "page", search: true, url: "https://www.latestdeals.co.uk/search?q={q}%20code"},
      {name: "Reddit", kind: "reddit_json", search: true, url: "https://www.reddit.com/search.json?q={q}%20code%20UK&sort=new&t=month&limit=50"},
      {name: "Reddit", kind: "reddit_json", url: "https://www.reddit.com/r/{slug:subreddit}/search.json?q=code%20OR%20promo%20OR%20voucher&restrict_sr=1&sort=new&t=year&limit=50"},
      {name: "VoucherCodes", kind: "page", url: "https://www.vouchercodes.co.uk/{slug:vouchercodes}"},
      {name: "MyVoucherCodes", kind: "page", url: "https://www.myvouchercodes.co.uk/{slug:myvouchercodes}"},
      {name: "Groupon", kind: "page", url: "https://www.groupon.co.uk/discount-codes/{slug:groupon}"},
      {name: "CouponFollow", kind: "page", url: "https://couponfollow.com/site/{slug:couponfollow}"},
      {name: "Wethrift", kind: "page", url: "https://www.wethrift.com/{slug:wethrift}"},
      {name: "Discoup", kind: "page", url: "https://www.discoup.com/uk/offer-code-discount-{slug:discoup}.html"},
      {name: "Savoo", kind: "page", url: "https://www.savoo.co.uk/brands/{slug:savoo}"},
      {name: "DealHack", kind: "page", url: "https://dealhack.com/coupons/{slug:dealhack}"},
    ],
    testing: {max_codes_per_run: 20, min_delay_seconds: 3, max_delay_seconds: 7, result_wait_seconds: 8},
  };

  // The URLs to fetch for one app: [{name, kind, url}], filling in {q} and {slug:...}.
  CONFIG.sourceUrls = function (siteKey, member) {
    const s = CONFIG.sites[siteKey], out = [];
    for (const src of CONFIG.sources) {
      const queries = src.search ? [[s.query, ""]].concat(member ? [[s.member_query, ` (${s.member_name})`]] : []) : [[s.query, ""]];
      for (const [q, label] of queries) {
        let missing = false;
        const url = src.url.replace("{q}", encodeURIComponent(q))
          .replace(/\{slug:(\w+)\}/g, (_, k) => (s.slugs && s.slugs[k]) || (missing = true, ""));
        if (!missing) out.push({name: src.name + label, kind: src.kind, url});
      }
    }
    return out;
  };

  CONFIG.siteForUrl = function (url) {
    try {
      const host = new URL(url).hostname;
      return Object.keys(CONFIG.sites).find(k => host === CONFIG.sites[k].domain || host.endsWith("." + CONFIG.sites[k].domain)) || null;
    } catch (e) { return null; }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CONFIG;
  else root.SnackConfig = CONFIG;
})(typeof globalThis !== "undefined" ? globalThis : this);
