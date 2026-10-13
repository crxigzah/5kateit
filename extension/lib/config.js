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
                  start_url: "https://deliveroo.co.uk/", domain: "deliveroo.co.uk", query: "Deliveroo"},
      justeat:   {name: "Just Eat", member_name: "Just Eat+", member_query: "Just Eat Plus",
                  start_url: "https://www.just-eat.co.uk/", domain: "just-eat.co.uk", query: "Just Eat"},
      ubereats:  {name: "Uber Eats", member_name: "Uber One", member_query: "Uber One",
                  start_url: "https://www.ubereats.com/gb", domain: "ubereats.com", query: "Uber Eats"},
    },
    sources: [
      {name: "HotUKDeals", kind: "page", url: "https://www.hotukdeals.com/search?q={q}%20code"},
      {name: "HotUKDeals vouchers", kind: "page", url: "https://www.hotukdeals.com/search/vouchers?q={q}"},
      {name: "Latest Deals", kind: "page", url: "https://www.latestdeals.co.uk/search?q={q}%20code"},
      {name: "Reddit", kind: "reddit_json", url: "https://www.reddit.com/search.json?q={q}%20code%20UK&sort=new&t=month&limit=50"},
    ],
    testing: {max_codes_per_run: 15, min_delay_seconds: 3, max_delay_seconds: 7, result_wait_seconds: 8},
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
